# hmx — container image
#
#   docker run --rm -v "$PWD:/src" ghcr.io/himanshu-2010/hmx hmx run main.hmx
#
# The image carries the compiler *and* a C compiler, because hmx transpiles to
# C and then shells out to gcc to build the program. That is what makes this
# image useful: it is a complete, toolchain-free way to run an .hmx file.
#
# Build locally:
#   docker build -t hmx .
#   docker run --rm -v "$PWD:/src" hmx run examples/hello.hmx
#
# The image runs as uid 1000. `hmx run` writes build_temp.c into the working
# directory, so the mounted directory has to be writable *by the container
# user*: on a machine where your uid is 1000 the command above just works, and
# anywhere else pass --user "$(id -u):$(id -g)". Without it you get
# "Error: cannot write build_temp.c in the current directory" naming the
# cause, rather than a confusing complaint from the C compiler.

# ── stage 1: build the compiler ──────────────────────────────
FROM debian:bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake flex bison ninja-build ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

RUN cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build \
    && cmake --install build --prefix /opt/hmx \
    && /opt/hmx/bin/hmx --version

# ── stage 2: runtime = compiler + C toolchain ────────────────
FROM debian:bookworm-slim

# gcc is not optional here: `hmx run` writes a .c file and calls the C
# compiler. No build-essential, no cmake/bison/flex — those are only needed to
# build hmx itself, which stage 1 already did.
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc libc6-dev make ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/hmx/bin/hmx /usr/local/bin/hmx

# Run as an unprivileged user; /src is the mount point for the caller's code.
RUN useradd --create-home --uid 1000 hmx \
    && mkdir -p /src && chown hmx /src
USER hmx
WORKDIR /src

# Fail the build if the compiler or the C toolchain is not actually usable,
# rather than at the first `hmx run`.
RUN printf 'fn main() -> int {\n    print("container ok")\n    return 7\n}\n' > /tmp/smoke.hmx \
    && cd /src && hmx run /tmp/smoke.hmx; test $? -eq 7

LABEL org.opencontainers.image.title="hmx" \
      org.opencontainers.image.description="HMX — a small statically typed systems language that transpiles to C" \
      org.opencontainers.image.source="https://github.com/himanshu-2010/hmx-lang" \
      org.opencontainers.image.licenses="MIT"

# `hmx` is the entrypoint, so the args are just the CLI's own:
#   docker run --rm -v "$PWD:/src" ghcr.io/himanshu-2010/hmx run main.hmx
#   docker run --rm -v "$PWD:/src" ghcr.io/himanshu-2010/hmx --version
ENTRYPOINT ["hmx"]
CMD ["--help"]
