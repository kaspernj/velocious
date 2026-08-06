# Development image for the Velocious `dev` Compose service.
# Source-independent on purpose: no project source or package manifests are
# copied and no project dependencies are installed here. The repository lives
# in the /home/dev bind mount and dependencies are installed with the normal
# project commands inside the running container.
#
# Base: Ubuntu 26.04 LTS, pinned by its current approved multi-arch digest.
# Node.js 24.x aligns with the Node major CI installs from the official
# tarball in tensorbuzz.yml; this image independently installs its pinned
# NodeSource package. When CI moves major versions, bump the signed
# NodeSource repository here too.
FROM ubuntu:26.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb

ARG NODEJS_VERSION=24.18.1-1nodesource1
ARG NODESOURCE_KEY_SHA256=b42e0321dabdc24e892115da705cf061167eac12a317f23d329862d0aa0a271d

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    wget \
    git \
    git-lfs \
    gh \
    openssh-client \
    gnupg \
    jq \
    ripgrep \
    fd-find \
    fzf \
    less \
    file \
    tree \
    bat \
    nano \
    vim-tiny \
    unzip \
    zip \
    xz-utils \
    bzip2 \
    tar \
    gzip \
    rsync \
    patch \
    diffutils \
    gawk \
    findutils \
    coreutils \
    procps \
    psmisc \
    lsof \
    iproute2 \
    iputils-ping \
    dnsutils \
    netcat-openbsd \
    socat \
    util-linux \
    tini \
    python3 \
    python3-venv \
    python3-pip \
    sqlite3 \
    shellcheck \
    tmux \
    zsh \
    man-db \
    build-essential \
    pkg-config \
    libssl-dev \
  && install -d -m 0755 /etc/apt/keyrings \
  && curl --fail --silent --show-error --location \
    https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    --output /etc/apt/keyrings/nodesource.asc \
  && echo "${NODESOURCE_KEY_SHA256}  /etc/apt/keyrings/nodesource.asc" | sha256sum --check - \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_24.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update \
  && apt-get install --yes --no-install-recommends "nodejs=${NODEJS_VERSION}" \
  && ln --symbolic /usr/bin/fdfind /usr/local/bin/fd \
  && ln --symbolic /usr/bin/batcat /usr/local/bin/bat \
  && test /usr/local/bin/fd -ef /usr/bin/fdfind \
  && test /usr/local/bin/bat -ef /usr/bin/batcat \
  && test "$(node --version)" = "v${NODEJS_VERSION%-1nodesource1}" \
  && rm -rf /var/lib/apt/lists/*

# Ubuntu 26.04 ships a default non-root "ubuntu" user (UID/GID 1000); rename
# it to the repository's normal "dev" identity.
RUN test "$(id -u ubuntu)" = "1000" \
  && test "$(id -g ubuntu)" = "1000" \
  && usermod --login dev --home /home/dev --move-home ubuntu \
  && groupmod --new-name dev ubuntu \
  && test "$(id -u dev)" = "1000" \
  && test "$(id -g dev)" = "1000"

# Remote latest metadata invalidates the provider install layer when a release changes.
ADD https://registry.npmjs.org/@moonshot-ai/kimi-code/latest /tmp/provider-cli-metadata/kimi-code.json
ADD https://registry.npmjs.org/@openai/codex/latest /tmp/provider-cli-metadata/codex.json
ADD https://registry.npmjs.org/@anthropic-ai/claude-code/latest /tmp/provider-cli-metadata/claude-code.json
ADD https://registry.npmjs.org/opencode-ai/latest /tmp/provider-cli-metadata/opencode.json

# Newest published provider CLIs from bare unversioned npm specs.
RUN npm install --global --prefix /usr/local \
    --allow-scripts="@anthropic-ai/claude-code,@moonshot-ai/kimi-code,node-pty,opencode-ai" \
    --strict-allow-scripts \
    "@moonshot-ai/kimi-code" \
    "@openai/codex" \
    "@anthropic-ai/claude-code" \
    "opencode-ai" \
  && kimi --version \
  && codex --version \
  && claude --version \
  && opencode --version \
  && rm -rf /tmp/provider-cli-metadata

USER dev
ENV HOME=/home/dev
WORKDIR /home/dev/velocious

# No image-level ENTRYPOINT: the Compose service declares `init: true`, so
# Docker's own init runs as PID 1 and owns signal reaping. A nested tini
# entrypoint would warn on every run ("Tini is not running as PID 1").
CMD ["sleep", "infinity"]
