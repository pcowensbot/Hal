module.exports = {
  apps: [{
    name: 'hal',
    script: './src/index.js',
    cwd: './server',
    // Fork mode — cluster would need rate limiters moved to Redis (5.5)
    // AND any other in-memory per-worker state audited before it's safe.
    // pm2's historic "cluster" reported in status is cosmetic when instances=1.
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
