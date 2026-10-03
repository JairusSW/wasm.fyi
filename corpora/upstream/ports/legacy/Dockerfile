# Linux toolchains for the retained Ruby 3.2.2 and YoWASP/Yosys 0.32 ports.
FROM swift@sha256:cd45c27b3abc42310c33cfaf3008b18156cbdc9187834c9617e8f43a26d2675c
RUN apt-get update -qq && apt-get install --no-install-recommends -y \
    make bison flex ccache gawk g++ python3 python-is-python3 ruby autoconf gperf curl \
    binaryen=108-1 && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 3 \
    https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-19/wasi-sdk-19.0-linux.tar.gz \
    -o /tmp/wasi-sdk.tar.gz && \
    echo 'd900abc826eec1955b9afd250e7cc2496338abbf6c440d86a313c06e42083fa1  /tmp/wasi-sdk.tar.gz' | sha256sum -c - && \
    tar -xzf /tmp/wasi-sdk.tar.gz -C /opt && rm /tmp/wasi-sdk.tar.gz
ENV WASI_SDK_PATH=/opt/wasi-sdk-19.0
# Mounted source trees are owned by the invoking user; this image is used only
# for the isolated corpus source-build directory.
RUN git config --global --add safe.directory /src && \
    git config --global --add safe.directory /src/yosys-src
