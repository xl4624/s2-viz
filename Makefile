.PHONY: build serve clean fmt dev pin

PORT ?= 8080

build:
	dune build main.bc.js

serve: build
	@pid=$$(lsof -t -i:$(PORT) 2>/dev/null); \
	  if [ -n "$$pid" ]; then echo "Killing prior server on :$(PORT) (pid $$pid)"; kill $$pid; sleep 0.3; fi
	@echo "Serving at http://localhost:$(PORT)/index.html"
	python3 -m http.server $(PORT)

dev: pin build serve

fmt:
	dune build @fmt --auto-promote

clean:
	dune clean
