// PM2 process definition for running the compiled API in production.
// Usage: npm run build && pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'auditorium-api',
      script: 'dist/server.js',
      instances: 'max', // cluster mode across CPU cores
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      max_memory_restart: '512M',
    },
  ],
};
