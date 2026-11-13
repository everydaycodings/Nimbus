// Nimbus Secrets CLI, Go edition. Same commands as packages/cli; see ../cli/CONTRACT.md.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var version = "dev"

type secret struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Type    string `json:"type"`
	Comment string `json:"comment"`
}
type config struct {
	Server string `json:"server,omitempty"`
	Token  string `json:"token,omitempty"`
}
type project struct {
	Project string `json:"project,omitempty"`
	Env     string `json:"env,omitempty"`
	Path    string `json:"path,omitempty"`
	Server  string `json:"server,omitempty"`
}

type fail struct {
	msg  string
	code int
}

func (f fail) Error() string { return f.msg }
func failf(code int, f string, a ...any) fail { return fail{fmt.Sprintf(f, a...), code} }

const help = `nimbus <command>
  login [--server URL]   logout   whoami
  init [--project P --env E --path /]
  secrets [--plain]      list secrets (masked unless --plain)
  run [--env E] [--path /] -- <cmd...>
  export [--format dotenv|json|yaml]
  agent --out FILE [--on-change CMD] [--interval SECONDS] [--format F] [--once]
  ssh cert --project P --principal deploy[,root] [--ttl HOURS] [--key PUBKEY_FILE] [--out FILE]
                         ask the project's SSH CA for a 1-8 hour certificate (no --key: new key pair)
Common: --project P --env E --path /   Env: NIMBUS_TOKEN NIMBUS_SERVER`

var boolFlags = map[string]bool{"plain": true, "once": true, "help": true}

func parse(argv []string) (flags map[string]string, pos, rest []string) {
	flags = map[string]string{}
	for i := 0; i < len(argv); i++ {
		a := argv[i]
		if a == "--" {
			rest = argv[i+1:]
			return
		}
		if !strings.HasPrefix(a, "--") {
			pos = append(pos, a)
			continue
		}
		name, val, hasEq := strings.Cut(a[2:], "=")
		switch {
		case hasEq:
			flags[name] = val
		case boolFlags[name]:
			flags[name] = "true"
		case i+1 < len(argv):
			i++
			flags[name] = argv[i]
		default:
			flags[name] = ""
		}
	}
	return
}

func configDir() string {
	if d := os.Getenv("NIMBUS_CONFIG_DIR"); d != "" {
		return d
	}
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		h, _ := os.UserHomeDir()
		base = filepath.Join(h, ".config")
	}
	return filepath.Join(base, "nimbus")
}

func readJSON(file string, v any) {
	if b, err := os.ReadFile(file); err == nil {
		_ = json.Unmarshal(b, v)
	}
}

func saveConfig(c config) error {
	if err := os.MkdirAll(configDir(), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	f := filepath.Join(configDir(), "config.json")
	if err := os.WriteFile(f, b, 0o600); err != nil {
		return err
	}
	return os.Chmod(f, 0o600)
}

const projectFile = ".nimbus.json"

type ctx struct{ server, token string }

func getCtx(flags map[string]string) (ctx, error) {
	var cfg config
	var p project
	readJSON(filepath.Join(configDir(), "config.json"), &cfg)
	readJSON(projectFile, &p)
	server := first(flags["server"], os.Getenv("NIMBUS_SERVER"), p.Server, cfg.Server)
	if server == "" {
		return ctx{}, failf(2, "No server. Run `nimbus login --server URL` or set NIMBUS_SERVER.")
	}
	return ctx{strings.TrimRight(server, "/"), first(os.Getenv("NIMBUS_TOKEN"), cfg.Token)}, nil
}

func first(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}

// call returns status, body, headers. Errors map non-2xx (except 304) to fail with CLI exit codes.
func call(c ctx, method, path string, body any, auth bool, hdr map[string]string) (int, []byte, http.Header, error) {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.server+"/api/v1/secrets"+path, rd)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	if auth {
		if c.token == "" {
			return 0, nil, nil, failf(4, "Not signed in. Run `nimbus login` or set NIMBUS_TOKEN.")
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := (&http.Client{Timeout: 70 * time.Second}).Do(req)
	if err != nil {
		return 0, nil, nil, failf(1, "Cannot reach %s: %v", c.server, err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode < 300 || res.StatusCode == 304 {
		return res.StatusCode, b, res.Header, nil
	}
	var e struct {
		Error     struct{ Message string } `json:"error"`
		UnlockURL string                   `json:"unlockUrl"`
	}
	_ = json.Unmarshal(b, &e)
	msg := first(e.Error.Message, http.StatusText(res.StatusCode))
	switch res.StatusCode {
	case 423:
		s := "Secrets are locked. Unlock them in the web app"
		if e.UnlockURL != "" {
			s += ": " + e.UnlockURL
		}
		return 0, nil, nil, fail{s, 3}
	case 401:
		return 0, nil, nil, failf(4, "Unauthorized: %s. Run `nimbus login`.", msg)
	}
	return 0, nil, nil, failf(1, "%d: %s", res.StatusCode, msg)
}

func target(flags map[string]string) (proj, env, path string) {
	var p project
	readJSON(projectFile, &p)
	return first(flags["project"], os.Getenv("NIMBUS_PROJECT"), p.Project),
		first(flags["env"], os.Getenv("NIMBUS_ENV"), p.Env),
		first(flags["path"], p.Path, "/")
}

// fetchSecrets returns (nil, etag, nil) on 304.
func fetchSecrets(c ctx, flags map[string]string, etag string) ([]secret, string, error) {
	proj, env, path := target(flags)
	q := url.Values{"path": {path}, "expand": {"true"}}
	if proj != "" {
		q.Set("project", proj)
	}
	if env != "" {
		q.Set("env", env)
	}
	hdr := map[string]string{}
	if etag != "" {
		hdr["If-None-Match"] = etag
	}
	st, b, h, err := call(c, "GET", "/secrets?"+q.Encode(), nil, true, hdr)
	if err != nil {
		return nil, etag, err
	}
	if st == 304 {
		return nil, etag, nil
	}
	var s []secret
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, etag, failf(1, "bad response: %v", err)
	}
	return s, h.Get("ETag"), nil
}

func quote(v string) string {
	v = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(v)
	return `"` + v + `"`
}

func format(secrets []secret, fmtName string) (string, error) {
	s := append([]secret(nil), secrets...)
	sort.Slice(s, func(i, j int) bool { return s[i].Key < s[j].Key })
	var sb strings.Builder
	switch fmtName {
	case "json":
		// Ordered output, matching the Node CLI's key order.
		sb.WriteString("{")
		for i, x := range s {
			k, _ := json.Marshal(x.Key)
			v, _ := json.Marshal(x.Value)
			if i > 0 {
				sb.WriteString(",")
			}
			fmt.Fprintf(&sb, "\n  %s: %s", k, v)
		}
		if len(s) > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString("}\n")
	case "yaml":
		for _, x := range s {
			v, _ := json.Marshal(x.Value)
			fmt.Fprintf(&sb, "%s: %s\n", x.Key, v)
		}
	case "dotenv":
		for _, x := range s {
			fmt.Fprintf(&sb, "%s=%s\n", x.Key, quote(x.Value))
		}
	default:
		return "", failf(2, "Unknown format %q (dotenv, json, yaml)", fmtName)
	}
	return sb.String(), nil
}

func writeAtomic(file, data string) error {
	tmp := fmt.Sprintf("%s.%d.tmp", file, os.Getpid())
	if err := os.WriteFile(tmp, []byte(data), 0o600); err != nil {
		return err
	}
	_ = os.Chmod(tmp, 0o600)
	return os.Rename(tmp, file)
}

func login(flags map[string]string) error {
	c, err := getCtx(flags)
	if err != nil {
		return err
	}
	host, _ := os.Hostname()
	_, b, _, err := call(c, "POST", "/auth/device/start", map[string]string{"deviceName": fmt.Sprintf("%s (%s)", host, runtime.GOOS)}, false, nil)
	if err != nil {
		return err
	}
	var s struct {
		UserCode, VerifyURL, PollToken string
		ExpiresIn                      float64
		Interval                       float64
	}
	var raw map[string]any
	_ = json.Unmarshal(b, &raw)
	s.UserCode, _ = raw["userCode"].(string)
	s.VerifyURL, _ = raw["verifyUrl"].(string)
	s.PollToken, _ = raw["pollToken"].(string)
	s.ExpiresIn, _ = raw["expiresIn"].(float64)
	s.Interval, _ = raw["interval"].(float64)
	if s.Interval == 0 {
		s.Interval = 2
	}
	fmt.Printf("Open %s\nand confirm the code %s\n", s.VerifyURL, s.UserCode)
	deadline := time.Now().Add(time.Duration(s.ExpiresIn * float64(time.Second)))
	for time.Now().Before(deadline) {
		time.Sleep(time.Duration(s.Interval * float64(time.Second)))
		body, _ := json.Marshal(map[string]string{"pollToken": s.PollToken})
		res, err := http.Post(c.server+"/api/v1/secrets/auth/device/poll", "application/json", bytes.NewReader(body))
		if err != nil {
			continue
		}
		rb, _ := io.ReadAll(res.Body)
		res.Body.Close()
		switch res.StatusCode {
		case 202:
			continue
		case 403:
			return failf(1, "Sign-in was denied.")
		case 200:
			var j struct {
				Token string
				User  struct{ Email string }
			}
			_ = json.Unmarshal(rb, &j)
			if err := saveConfig(config{c.server, j.Token}); err != nil {
				return err
			}
			if j.User.Email != "" {
				fmt.Printf("Signed in as %s.\n", j.User.Email)
			} else {
				fmt.Println("Signed in.")
			}
			return nil
		default:
			return failf(1, "Sign-in code expired. Try again.")
		}
	}
	return failf(1, "Sign-in code expired. Try again.")
}

func logout() error {
	var cfg config
	readJSON(filepath.Join(configDir(), "config.json"), &cfg)
	if cfg.Token != "" && cfg.Server != "" {
		_, _, _, _ = call(ctx{cfg.Server, cfg.Token}, "POST", "/auth/logout", nil, true, nil) // best effort
	}
	if err := saveConfig(config{Server: cfg.Server}); err != nil {
		return err
	}
	fmt.Println("Signed out.")
	return nil
}

func whoami(flags map[string]string) error {
	c, err := getCtx(flags)
	if err != nil {
		return err
	}
	_, b, _, err := call(c, "GET", "/whoami", nil, true, nil)
	if err != nil {
		return err
	}
	var w struct{ Type, Name, Email string }
	_ = json.Unmarshal(b, &w)
	who := first(w.Email, w.Name)
	if w.Type == "machine" {
		who = "token"
	}
	fmt.Printf("%s (%s) on %s\n", who, w.Type, c.server)
	return nil
}

func initCmd(flags map[string]string) error {
	proj, env, path := target(flags)
	if proj == "" {
		return failf(2, "Pass --project (and --env).")
	}
	b, _ := json.MarshalIndent(project{Project: proj, Env: env, Path: path}, "", "  ")
	if err := os.WriteFile(projectFile, append(b, '\n'), 0o644); err != nil {
		return err
	}
	fmt.Println("Wrote " + projectFile)
	return nil
}

func secretsCmd(flags map[string]string) error {
	c, err := getCtx(flags)
	if err != nil {
		return err
	}
	s, _, err := fetchSecrets(c, flags, "")
	if err != nil {
		return err
	}
	for _, x := range s {
		v := "********"
		if flags["plain"] != "" {
			v = strings.ReplaceAll(x.Value, "\n", `\n`)
		}
		fmt.Printf("%s\t%s\n", x.Key, v)
	}
	return nil
}

func exportCmd(flags map[string]string) error {
	c, err := getCtx(flags)
	if err != nil {
		return err
	}
	s, _, err := fetchSecrets(c, flags, "")
	if err != nil {
		return err
	}
	out, err := format(s, first(flags["format"], "dotenv"))
	if err != nil {
		return err
	}
	fmt.Print(out)
	return nil
}

func runCmd(flags map[string]string, args []string) (int, error) {
	if len(args) == 0 {
		return 0, failf(2, "Usage: nimbus run [--env E] -- <command>")
	}
	c, err := getCtx(flags)
	if err != nil {
		return 0, err
	}
	s, _, err := fetchSecrets(c, flags, "")
	if err != nil {
		return 0, err
	}
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Env = os.Environ()
	for _, x := range s {
		cmd.Env = append(cmd.Env, x.Key+"="+x.Value) // later entries win
	}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "nimbus: %v\n", err)
		return 127, nil
	}
	sigs := make(chan os.Signal, 4)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() {
		for sig := range sigs {
			_ = cmd.Process.Signal(sig)
		}
	}()
	err = cmd.Wait()
	signal.Stop(sigs)
	if ee, ok := err.(*exec.ExitError); ok {
		if ws, ok := ee.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
			return 128 + int(ws.Signal()), nil
		}
		return ee.ExitCode(), nil
	}
	return 0, nil
}

func agent(flags map[string]string) error {
	out := flags["out"]
	if out == "" {
		return failf(2, "--out FILE is required.")
	}
	fmtName := first(flags["format"], "dotenv")
	interval := 30.0
	if v, err := strconv.ParseFloat(flags["interval"], 64); err == nil && v >= 1 {
		interval = v
	}
	c, err := getCtx(flags)
	if err != nil {
		return err
	}
	once := flags["once"] != ""
	etag := ""
	for {
		s, tag, err := fetchSecrets(c, flags, etag)
		if err != nil {
			f, _ := err.(fail)
			if f.code == 4 || f.code == 2 || (etag == "" && once) {
				return err
			}
			fmt.Fprintf(os.Stderr, "nimbus: %v\n", err)
		} else if s != nil {
			etag = tag
			data, ferr := format(s, fmtName)
			if ferr != nil {
				return ferr
			}
			if old, rerr := os.ReadFile(out); rerr != nil || string(old) != data {
				_ = os.MkdirAll(filepath.Dir(out), 0o755)
				if err := writeAtomic(out, data); err != nil {
					return err
				}
				fmt.Fprintf(os.Stderr, "nimbus: wrote %s\n", out)
				if hook := flags["on-change"]; hook != "" {
					h := exec.Command("sh", "-c", hook)
					h.Env = append(os.Environ(), "NIMBUS_OUT="+out)
					h.Stdout, h.Stderr = os.Stdout, os.Stderr
					_ = h.Run()
				}
			}
		}
		if once {
			return nil
		}
		time.Sleep(time.Duration(interval * float64(time.Second)))
	}
}

// sshCert asks the project's SSH CA for a certificate. With --key it is written next to
// that key (KEY-cert.pub); otherwise Nimbus makes a key pair and both land under --out
// (default ~/.ssh/nimbus_cert).
func sshCert(flags map[string]string) error {
	var principals []string
	for _, p := range strings.Split(flags["principal"], ",") {
		if p = strings.TrimSpace(p); p != "" {
			principals = append(principals, p)
		}
	}
	if len(principals) == 0 {
		return failf(2, "Pass --principal user[,user] (the accounts it may log in as).")
	}
	proj, _, _ := target(flags)
	if proj == "" {
		return failf(2, "Pass --project.")
	}
	ttl := 1.0
	if v, err := strconv.ParseFloat(flags["ttl"], 64); err == nil {
		ttl = v
	}
	body := map[string]any{"project": proj, "principals": principals, "ttl": ttl}
	if k := flags["key"]; k != "" {
		b, err := os.ReadFile(k)
		if err != nil {
			return failf(1, "%v", err)
		}
		body["publicKey"] = strings.TrimSpace(string(b))
	}
	c, err := getCtx(flags)
	if err != nil {
		return err
	}
	_, b, _, err := call(c, "POST", "/ssh/cert", body, true, nil)
	if err != nil {
		return err
	}
	var r struct {
		Certificate string  `json:"certificate"`
		PrivateKey  *string `json:"privateKey"`
		ExpiresAt   string  `json:"expiresAt"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return failf(1, "bad response: %v", err)
	}
	home, _ := os.UserHomeDir()
	keyFile := first(flags["out"], filepath.Join(home, ".ssh", "nimbus_cert"))
	if k := flags["key"]; k != "" {
		keyFile = strings.TrimSuffix(k, ".pub")
	}
	certFile := keyFile + "-cert.pub"
	_ = os.MkdirAll(filepath.Dir(keyFile), 0o700)
	if r.PrivateKey != nil {
		if err := writeAtomic(keyFile, *r.PrivateKey); err != nil {
			return err
		}
	}
	if err := os.WriteFile(certFile, []byte(r.Certificate+"\n"), 0o644); err != nil {
		return err
	}
	fmt.Printf("Certificate valid until %s: %s\n", r.ExpiresAt, certFile)
	fmt.Printf("ssh -i %s -o CertificateFile=%s %s@HOST\n", keyFile, certFile, principals[0])
	return nil
}

func main() {
	flags, pos, rest := parse(os.Args[1:])
	if len(pos) == 0 || flags["help"] != "" {
		fmt.Println(help)
		return
	}
	var err error
	switch pos[0] {
	case "version":
		fmt.Println(version)
	case "login":
		err = login(flags)
	case "logout":
		err = logout()
	case "whoami":
		err = whoami(flags)
	case "init":
		err = initCmd(flags)
	case "secrets":
		err = secretsCmd(flags)
	case "export":
		err = exportCmd(flags)
	case "agent":
		err = agent(flags)
	case "ssh":
		if len(pos) < 2 || pos[1] != "cert" {
			err = failf(2, "Usage: nimbus ssh cert --project P --principal user\n%s", help)
		} else {
			err = sshCert(flags)
		}
	case "run":
		var code int
		code, err = runCmd(flags, rest)
		if err == nil {
			os.Exit(code)
		}
	default:
		err = failf(2, "Unknown command %q\n%s", pos[0], help)
	}
	if err != nil {
		code := 1
		if f, ok := err.(fail); ok {
			code = f.code
		}
		fmt.Fprintf(os.Stderr, "nimbus: %v\n", err)
		os.Exit(code)
	}
}
