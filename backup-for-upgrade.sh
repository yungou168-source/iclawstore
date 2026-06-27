#!/bin/bash
# =============================================
# ClawHub 系统升级备份脚本
# 执行时间: 2026-06-25
# =============================================

BACKUP_DIR="/root/backup-iclawstore-$(date +%Y%m%d-%H%M%S)"
PROJECT_DIR="/www/wwwroot/iclawstore.com"

echo "=========================================="
echo "ClawHub 系统升级备份"
echo "备份目录: $BACKUP_DIR"
echo "=========================================="

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 1. 网站源码和构建产物
echo "[1/5] 备份网站数据..."
tar -czf "$BACKUP_DIR/website-source.tar.gz" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='.output' \
    -C /www/wwwroot iclawstore.com

# 构建产物单独备份（重要！）
tar -czf "$BACKUP_DIR/website-output.tar.gz" \
    -C /www/wwwroot/iclawstore.com .output

# 环境变量文件
cp "$PROJECT_DIR/.env.local" "$BACKUP_DIR/"

# 2. SSL 证书
echo "[2/5] 备份 SSL 证书..."
mkdir -p "$BACKUP_DIR/ssl"
cp -r /www/server/panel/vhost/cert/iclawstore.com/* "$BACKUP_DIR/ssl/"

# 3. Nginx 配置
echo "[3/5] 备份 Nginx 配置..."
mkdir -p "$BACKUP_DIR/nginx"
cp /www/server/nginx/conf/vhost/iclawstore.com.conf "$BACKUP_DIR/nginx/"
cp -r /www/server/panel/vhost/nginx/rewrite/iclawstore.com.conf "$BACKUP_DIR/nginx/" 2>/dev/null || true
cp -r /www/server/panel/vhost/nginx/extension/iclawstore.com "$BACKUP_DIR/nginx/" 2>/dev/null || true
cp -r /www/server/panel/vhost/nginx/well-known/iclawstore.com.conf "$BACKUP_DIR/nginx/" 2>/dev/null || true

# 4. PM2 配置
echo "[4/5] 备份 PM2 配置..."
mkdir -p "$BACKUP_DIR/pm2"
pm2 save
cp /root/.pm2/dump.pm2 "$BACKUP_DIR/pm2/" 2>/dev/null || true
cp /root/.pm2/.pm2_conf.bak "$BACKUP_DIR/pm2/" 2>/dev/null || true
cp "$PROJECT_DIR/start-bun.sh" "$BACKUP_DIR/pm2/"

# 5. 生成备份清单
echo "[5/5] 生成备份清单..."
cat > "$BACKUP_DIR/backup-manifest.txt" << EOF
========================================
ClawHub 备份清单
备份时间: $(date)
服务器: $(hostname)
========================================

1. 网站源码: website-source.tar.gz
   - 排除: node_modules, .git, .output

2. 构建产物: website-output.tar.gz
   - 包含: .output/public/* (CSS, JS, 图片等)
   - 重要性: ⭐⭐⭐ 必需

3. 环境变量: .env.local
   - 包含: VITE_CONVEX_URL, CONVEX_DEPLOY_KEY, AUTH_GITHUB_* 等
   - 重要性: ⭐⭐⭐ 必需

4. SSL 证书: ssl/
   - fullchain.pem, privkey.pem

5. Nginx 配置: nginx/
   - vhost 配置, rewrite 规则, extension 配置

6. PM2 配置: pm2/
   - 启动脚本, 进程列表

========================================
恢复步骤:
========================================
1. 解压网站数据:
   tar -xzf website-source.tar.gz -C /www/wwwroot/
   tar -xzf website-output.tar.gz -C /www/wwwroot/iclawstore.com/

2. 恢复环境变量:
   cp .env.local /www/wwwroot/iclawstore.com/

3. 恢复 SSL 证书:
   cp -r ssl/* /www/server/panel/vhost/cert/iclawstore.com/

4. 恢复 Nginx 配置:
   cp nginx/* /www/server/nginx/conf/vhost/

5. 恢复 PM2:
   pm2 resurrect

6. 重启服务:
   pm2 restart iclawstore
   nginx -t && nginx -s reload
========================================
EOF

echo ""
echo "=========================================="
echo "备份完成!"
echo "备份位置: $BACKUP_DIR"
echo "备份大小: $(du -sh "$BACKUP_DIR" | cut -f1)"
echo "=========================================="
echo ""
echo "下一步操作:"
echo "1. 下载备份到本地: scp -r $BACKUP_DIR user@backup-server:/"
echo "2. 验证备份完整性: ls -la $BACKUP_DIR"
echo "3. 开始系统升级"
echo ""
