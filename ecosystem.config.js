module.exports = {
  apps: [{
    name: 'informe-clima',
    script: 'server.js',
    watch: ['server.js', 'routes', 'middleware', 'db', 'lib'],
    ignore_watch: ['node_modules', 'logs', '*.json'],
    watch_delay: 500,
    restart_delay: 1000,
    max_restarts: 20,
    min_uptime: '5s',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
  }]
};
