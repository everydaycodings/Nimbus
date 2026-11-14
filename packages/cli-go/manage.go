// share, webhooks and push: the same commands as packages/cli (CONTRACT.md "Share links",
// "Webhooks and server push").
package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

func init() {
	boolFlags["password"] = true
	boolFlags["auto"] = true
}

// callJSON makes the call and decodes the answer into out (when not nil).
func callJSON(c ctx, method, path string, body, out any) error {
	_, b, _, err := call(c, method, path, body, true, nil)
	if err != nil || out == nil {
		return err
	}
	if err := json.Unmarshal(b, out); err != nil {
		return failf(1, "bad response: %v", err)
	}
	return nil
}

var expiresRE = regexp.MustCompile(`^(\d+)([mhd]?)$`)

func shareCmd(flags map[string]string, pos []string) error {
	c, err := getCtx(flags)
	if err != nil {
		return err
	}
	if len(pos) > 1 && pos[1] == "list" {
		var r struct {
			Shares []struct {
				ID        string  `json:"id"`
				State     string  `json:"state"`
				Views     int     `json:"views"`
				MaxViews  int     `json:"maxViews"`
				ExpiresAt string  `json:"expiresAt"`
				Label     *string `json:"label"`
			} `json:"shares"`
		}
		if err := callJSON(c, "GET", "/shares", nil, &r); err != nil {
			return err
		}
		for _, s := range r.Shares {
			label := ""
			if s.Label != nil {
				label = *s.Label
			}
			fmt.Printf("%s\t%s\t%d/%d\t%s\t%s\n", s.ID, s.State, s.Views, s.MaxViews, s.ExpiresAt, label)
		}
		return nil
	}
	if len(pos) > 1 && pos[1] == "revoke" {
		if len(pos) < 3 {
			return failf(2, "Usage: nimbus share revoke ID")
		}
		if err := callJSON(c, "DELETE", "/shares?id="+url.QueryEscape(pos[2]), nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(os.Stderr, "Revoked.")
		return nil
	}
	// A stray word means `--password secret "text"`: refuse rather than share the password.
	if len(pos) > 2 {
		return failf(2, "Quote the text (or pipe it in), and use --password=VALUE for your own password.")
	}
	var text string
	if len(pos) == 2 {
		text = pos[1]
	} else {
		b, err := io.ReadAll(os.Stdin)
		if err != nil {
			return failf(1, "%v", err)
		}
		text = string(b)
	}
	m := expiresRE.FindStringSubmatch(first(flags["expires"], "1d"))
	if m == nil {
		return failf(2, "--expires is like 90m, 12h or 7d.")
	}
	n, _ := strconv.Atoi(m[1])
	minutes := n * map[string]int{"m": 1, "h": 60, "d": 1440, "": 60}[m[2]]
	views, _ := strconv.Atoi(first(flags["views"], "1"))
	body := map[string]any{"text": text, "minutes": minutes, "maxViews": views}
	made := flags["password"] == "true"
	pw := flags["password"]
	if made {
		buf := make([]byte, 12)
		_, _ = rand.Read(buf)
		pw = base64.RawURLEncoding.EncodeToString(buf)
	}
	if pw != "" {
		body["password"] = pw
	}
	if l := flags["label"]; l != "" {
		body["label"] = l
	}
	var r struct {
		URL string `json:"url"`
	}
	if err := callJSON(c, "POST", "/shares", body, &r); err != nil {
		return err
	}
	fmt.Println(r.URL)
	if made {
		fmt.Fprintf(os.Stderr, "Password: %s  (send it another way)\n", pw)
	}
	return nil
}

// envBase is /projects/P/envs/E (needEnv) or /projects/P.
func envBase(flags map[string]string, needEnv bool) (string, error) {
	proj, env, _ := target(flags)
	if proj == "" || (needEnv && env == "") {
		what := "--project"
		if needEnv {
			what += " and --env"
		}
		return "", failf(2, "Pass %s (or run nimbus init).", what)
	}
	base := "/projects/" + url.PathEscape(proj)
	if needEnv {
		base += "/envs/" + url.PathEscape(env)
	}
	return base, nil
}

func webhooksCmd(flags map[string]string, pos []string) error {
	c, err := getCtx(flags)
	if err != nil {
		return err
	}
	base, err := envBase(flags, true)
	if err != nil {
		return err
	}
	base += "/webhooks"
	sub, arg := "list", ""
	if len(pos) > 1 {
		sub = pos[1]
	}
	if len(pos) > 2 {
		arg = pos[2]
	}
	switch {
	case sub == "list":
		var r struct {
			Hooks []struct {
				ID      string `json:"id"`
				URL     string `json:"url"`
				Enabled bool   `json:"enabled"`
			} `json:"hooks"`
		}
		if err := callJSON(c, "GET", base, nil, &r); err != nil {
			return err
		}
		for _, h := range r.Hooks {
			state := "off"
			if h.Enabled {
				state = "on"
			}
			fmt.Printf("%s\t%s\t%s\n", h.ID, state, h.URL)
		}
	case arg == "":
		return failf(2, "Usage: nimbus webhooks list|add URL|remove ID|test ID --env E\n%s", help)
	case sub == "add":
		var r struct{ ID, Secret string }
		if err := callJSON(c, "POST", base, map[string]string{"url": arg}, &r); err != nil {
			return err
		}
		fmt.Printf("%s\nSigning secret (shown once): %s\n", r.ID, r.Secret)
	case sub == "remove":
		if err := callJSON(c, "DELETE", base+"/"+url.PathEscape(arg), nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(os.Stderr, "Removed.")
	case sub == "test":
		var r struct {
			Status     string  `json:"status"`
			HTTPStatus *int    `json:"httpStatus"`
			Message    *string `json:"message"`
		}
		if err := callJSON(c, "POST", base+"/"+url.PathEscape(arg)+"/test", nil, &r); err != nil {
			return err
		}
		code := ""
		if r.HTTPStatus != nil {
			code = strconv.Itoa(*r.HTTPStatus)
		}
		if r.Status == "delivered" {
			fmt.Printf("delivered (%s)\n", code)
			return nil
		}
		msg := code
		if r.Message != nil {
			msg = *r.Message
		}
		fmt.Printf("failed: %s\n", msg)
		return failf(1, "The test delivery failed.")
	default:
		return failf(2, "Usage: nimbus webhooks list|add URL|remove ID|test ID --env E\n%s", help)
	}
	return nil
}

func pushCmd(flags map[string]string, pos []string) error {
	c, err := getCtx(flags)
	if err != nil {
		return err
	}
	sub := "list"
	if len(pos) > 1 {
		sub = pos[1]
	}
	if sub == "list" {
		base, err := envBase(flags, false)
		if err != nil {
			return err
		}
		var r struct {
			Targets []struct {
				Env, Host, Username, Path string
				Port                      int
				Auto                      bool
				LastOk                    *bool   `json:"lastOk"`
				LastMessage               *string `json:"lastMessage"`
			} `json:"targets"`
		}
		if err := callJSON(c, "GET", base+"/push", nil, &r); err != nil {
			return err
		}
		for _, x := range r.Targets {
			mode, last, msg := "manual", "never", ""
			if x.Auto {
				mode = "auto"
			}
			if x.LastOk != nil {
				last = map[bool]string{true: "ok", false: "failed"}[*x.LastOk]
			}
			if x.LastMessage != nil {
				msg = *x.LastMessage
			}
			fmt.Printf("%s\t%s@%s:%d\t%s\t%s\t%s\t%s\n", x.Env, x.Username, x.Host, x.Port, x.Path, mode, last, msg)
		}
		return nil
	}
	base, err := envBase(flags, true)
	if err != nil {
		return err
	}
	base += "/push"
	switch sub {
	case "run":
		var r struct{ Message string }
		if err := callJSON(c, "POST", base, nil, &r); err != nil {
			return err
		}
		fmt.Println(r.Message)
	case "remove":
		if err := callJSON(c, "DELETE", base, nil, nil); err != nil {
			return err
		}
		fmt.Fprintln(os.Stderr, "Removed.")
	case "set":
		if flags["host"] == "" || flags["user"] == "" || flags["path"] == "" {
			return failf(2, "push set needs --host, --user and --path.")
		}
		port, err := strconv.Atoi(first(flags["port"], "22"))
		if err != nil {
			return failf(2, "--port is a number.")
		}
		body := map[string]any{
			"host": flags["host"], "port": port, "username": flags["user"], "path": flags["path"],
			"postCommand": flags["command"], "auto": flags["auto"] == "true",
		}
		if f := flags["key"]; f != "" {
			k, err := os.ReadFile(f)
			if err != nil {
				return failf(1, "%v", err)
			}
			body["privateKey"] = strings.TrimSpace(string(k)) + "\n"
		}
		if id := flags["key-id"]; id != "" {
			body["keyId"] = id
		}
		if err := callJSON(c, "PUT", base, body, nil); err != nil {
			return err
		}
		fmt.Fprintln(os.Stderr, "Saved. Run `nimbus push run` to push now.")
	default:
		return failf(2, "Usage: nimbus push list|set|run|remove --env E\n%s", help)
	}
	return nil
}
