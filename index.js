require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { supabase } = require('./config/database');
const propertiesRouter = require('./routes/properties');
const usersRouter = require('./routes/users');
const agentsRouter = require('./routes/agents');
const testimonialsRouter = require('./routes/testimonials');
const contactSubmissionsRouter = require('./routes/contact_submission');
const propertyInquiryRouter = require('./routes/property_inquiry');
const faqRouter = require('./routes/faq');
const blogRouter = require('./routes/blog');
const authRouter = require('./routes/auth');
const { authenticateToken, isAdmin } = require('./middleware/auth');
const notificationsRouter = require('./routes/notifications');
const dashboardRouter = require('./routes/dashboard');
const analyticsRouter = require('./routes/analytics');
const profileRouter = require('./routes/profile');
const propertyViewsRouter = require('./routes/property_views');

const app = express();

// Middleware
// Configure CORS using environment variable (comma-separated list) or default to localhost
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:4000', 'http://localhost:3000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set secure HTTP headers
app.use(helmet());

// Basic rate limiting (100 requests per 15 minutes per IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Public routes
app.use('/api/auth', authRouter);
app.use('/api/property-views', propertyViewsRouter);

// Protected routes
app.use('/api/dashboard', authenticateToken, dashboardRouter);
app.use('/api/properties', authenticateToken, propertiesRouter);
app.use('/api/testimonials', authenticateToken, testimonialsRouter);
app.use('/api/contact-submissions', authenticateToken, contactSubmissionsRouter);
app.use('/api/property-inquiries', authenticateToken, propertyInquiryRouter);
app.use('/api/faqs', authenticateToken, faqRouter);
app.use('/api/blogs', authenticateToken, blogRouter);
app.use('/api/analytics', authenticateToken, analyticsRouter);
app.use('/api/profile', authenticateToken, profileRouter);

// Admin routes
app.use('/api/users', authenticateToken, isAdmin, usersRouter);
app.use('/api/agents', authenticateToken, isAdmin, agentsRouter);

// Settings routes - require both authentication and admin privileges
app.use('/api/notifications', notificationsRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test database connection
app.get('/test-db', async (req, res) => {
  try {
    const { data, error } = await supabase.from('profiles').select('count');
    if (error) throw error;
    res.json({ status: 'Database connection successful', data });
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(500).json({ error: 'Failed to connect to database' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    details: err.details || null
  });
  res.status(err.status || 500).json({ 
    error: err.message || 'Something went wrong!',
    details: err.details || null
  });
});

// Check if JWT_SECRET is set
if (!process.env.JWT_SECRET) {
  console.error('ERROR: JWT_SECRET is not set in environment variables!');
  console.error('Authentication will not work correctly.');
  process.exit(1); // Exit with error
}

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
}); 