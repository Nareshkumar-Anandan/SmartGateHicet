function errorHandler(err, req, res, next) {
  console.error('[Unhandled Error]', err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'An unexpected internal server error occurred.';

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
}

module.exports = {
  errorHandler
};
