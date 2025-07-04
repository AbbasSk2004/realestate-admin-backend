const { supabase, supabaseAdmin } = require('../config/database');
const jwt = require('jsonwebtoken');

const authenticateToken = async (req, res, next) => {
  try {
    // Log request info
    console.log(`Auth middleware - ${req.method} request to: ${req.path}`);
    
    // Try to get token from Authorization header first
    const authHeader = req.headers.authorization;
    let token = null;
    
    if (authHeader) {
      console.log('Auth middleware - Authorization header found');
      // Handle different formats: "Bearer token" or just "token"
      token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    }

    // If no token in header, try query parameter
    if (!token && req.query.token) {
      console.log('Auth middleware - using token from query parameter');
      token = req.query.token;
    }

    // If still no token, return error
    if (!token) {
      console.log('Auth middleware - no token provided');
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify JWT token
    console.log('Auth middleware - verifying token');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded) {
      console.log('Auth middleware - invalid token');
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Extract user ID from decoded token
    const userId = decoded.userId || decoded.sub;
    console.log('Auth middleware - decoded user ID:', userId);
    
    if (!userId) {
      console.log('Auth middleware - missing user ID in token');
      return res.status(401).json({ error: 'Invalid token: missing user ID' });
    }

    // Get user profile directly from the profiles table using admin client to bypass RLS
    console.log('Auth middleware - fetching user profile (admin client)');
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('profiles_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('Profile fetch error:', profileError || 'Profile not found');
      return res.status(401).json({ error: 'User profile not found' });
    }

    console.log('Auth middleware - profile found, role:', profile.role);

    // Set user data in request
    req.user = {
      userId: userId,
      email: profile.email,
      role: profile.role,
      profile: profile
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(401).json({ error: 'Authentication failed', details: error.message });
  }
};

const isAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    next();
  } catch (error) {
    console.error('Admin verification error:', error);
    res.status(500).json({ error: 'Error verifying admin status' });
  }
};

module.exports = { authenticateToken, isAdmin }; 