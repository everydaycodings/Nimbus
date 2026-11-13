# Cross-compiles dist/nimbus-<os>-<arch>[.exe]. Needs only the Go toolchain.
TARGETS = linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64
VERSION ?= 0.1.0

all:
	@for t in $(TARGETS); do \
	  os=$${t%/*}; arch=$${t#*/}; ext=; [ $$os = windows ] && ext=.exe; \
	  echo $$os/$$arch; \
	  CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o dist/nimbus-$$os-$$arch$$ext . || exit 1; \
	done

test:
	go vet ./... && go test ./...

clean:
	rm -rf dist
