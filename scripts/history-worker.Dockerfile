FROM golang:1.26 AS go
FROM node:26.4.0-bookworm AS node
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake curl git gh ninja-build pkg-config \
    python3 ruby openjdk-21-jdk-headless libssl-dev llvm-18-dev liblld-18-dev clang-18 lld-18 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=go /usr/local/go /usr/local/go
COPY --from=node /usr/local/bin/node /usr/local/bin/node
ENV PATH=/root/.cargo/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin
RUN curl --fail --silent --show-error https://sh.rustup.rs -o /tmp/rustup.sh \
    && sh /tmp/rustup.sh -y --profile minimal \
    && rm /tmp/rustup.sh
ENV LLVM_DIR=/usr/lib/llvm-18/lib/cmake/llvm GOWORK=off
WORKDIR /root/.cache/wasm-fyi/site
