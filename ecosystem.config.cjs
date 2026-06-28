module.exports = {
  apps: [
    {
      name: 'iclawstore',
      script: '/home/ubuntu/.local/bin/bun',
      args: 'dev --port 3000',
      cwd: '/www/wwwroot/iclawstore.com',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'iclawstore-api',
      script: '/home/ubuntu/.local/bin/bun',
      args: 'x tsx src/index.ts',
      cwd: '/www/wwwroot/iclawstore.com/server',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        HOST: '0.0.0.0',
        DATABASE_URL: 'mysql://root:iclawstore123@127.0.0.1:3306/iclawstore',
        JWT_SECRET: 'change-me-in-production-use-a-long-random-string',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
    },
  ],
};
