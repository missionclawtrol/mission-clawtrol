module.exports = {
  apps: [
    {
      name: 'clawtrol-backend',
      cwd: './services/backend',
      script: 'npm',
      args: 'run dev',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      env: {
        NODE_ENV: 'development',
        PORT: 3001
      }
    },
    {
      name: 'clawtrol-dashboard',
      cwd: './apps/dashboard',
      script: 'npm',
      args: 'run dev',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      env: {
        NODE_ENV: 'development',
        PORT: 5173
      }
    }
  ]
};
