#!/bin/bash
# =============================================
# MySQL 数据库设置脚本
# =============================================

set -e

DB_NAME="iclawstore"
DB_USER="root"
DB_PASS=""

echo "============================================="
echo "MySQL 数据库设置"
echo "============================================="

# 读取密码
if [ -n "$1" ]; then
    DB_PASS="$1"
fi

# 创建数据库
echo "创建数据库: $DB_NAME"

if [ -n "$DB_PASS" ]; then
    mysql -u "$DB_USER" -p"$DB_PASS" <<EOF
CREATE DATABASE IF NOT EXISTS $DB_NAME 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE $DB_NAME;

-- 创建用户(如果需要)
-- CREATE USER IF NOT EXISTS 'clawhub'@'localhost' IDENTIFIED BY 'your_password';
-- GRANT ALL PRIVILEGES ON $DB_NAME.* TO 'clawhub'@'localhost';
-- FLUSH PRIVILEGES;

SELECT 'Database created successfully!' AS Status;
EOF
else
    mysql -u "$DB_USER" <<EOF
CREATE DATABASE IF NOT EXISTS $DB_NAME 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE $DB_NAME;
SELECT 'Database created successfully!' AS Status;
EOF
fi

echo ""
echo "============================================="
echo "下一步:"
echo "1. 复制配置文件: cp .env.migration.example .env"
echo "2. 编辑 .env 设置数据库密码"
echo "3. 运行 Prisma 迁移: bunx prisma migrate dev"
echo "4. 运行数据迁移: bun run migrations/run.ts"
echo "============================================="
