#!/bin/bash
# Bun 和 PM2 路径配置 (Ubuntu 24.04)
export PATH="$HOME/.local/bin:$PATH"
cd /www/wwwroot/iclawstore.com

# 加载环境变量
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
fi

# 启动 Nitro SSR 服务
bun /www/wwwroot/iclawstore.com/.output/server/index.mjs
