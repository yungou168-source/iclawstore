module.exports = {
  apps: [{
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
  }],
};
