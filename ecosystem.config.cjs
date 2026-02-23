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
    },
    {
      name: 'clawtrol-voice',
      cwd: './services/voice',
      script: 'python3',
      args: 'main.py',
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
      interpreter: 'none',
      env: {
        VOICE_PORT: '8766',
        WHISPER_MODEL: 'base',
        PIPER_VOICE: 'en_US-lessac-medium',
        MC_BACKEND_WS: 'ws://localhost:3001/ws/gateway',
        VOICE_SESSION_KEY: 'agent:cso:mc-voice',
        VOICE_MODELS_DIR: process.env.HOME + '/.openclaw/voice-models'
      }
    }
  ]
};
