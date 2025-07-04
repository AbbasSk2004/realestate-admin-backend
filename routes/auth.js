const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { supabase, supabaseAdmin } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt for email:', email);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // First, authenticate with Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      console.error('Authentication error:', authError);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('Supabase auth successful for user ID:', authData.user.id);

    // Then, get the user profile to check role (use admin client to bypass RLS issues)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('profiles_id', authData.user.id)
      .single();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
      return res.status(500).json({ error: 'Error fetching user profile' });
    }

    if (!profile || profile.role !== 'admin') {
      console.log('User role check failed:', profile?.role);
      return res.status(403).json({ error: 'Access denied. Only administrators can login.' });
    }

    console.log('Profile found, role:', profile.role, 'current status:', profile.status);

    // Update user status to active
    console.log('Updating user status to active for user ID:', authData.user.id);
    
    const updateResult = await supabaseAdmin
      .from('profiles')
      .update({ 
        status: 'active',
        last_login: new Date().toISOString()
      })
      .eq('profiles_id', authData.user.id);
      
    if (updateResult.error) {
      console.error('Error updating user status:', updateResult.error);
      console.error('Update error details:', JSON.stringify(updateResult, null, 2));
      // Continue with login even if status update fails
    } else {
      console.log('User status updated successfully to active');
    }

    // Generate JWT token with all required claims
    const token = jwt.sign(
      { 
        sub: profile.profiles_id, // Add sub claim for Supabase
        userId: profile.profiles_id,
        role: profile.role,
        email: profile.email,
        firstname: profile.firstname,
        lastname: profile.lastname
      },
      process.env.JWT_SECRET,
      { 
        expiresIn: '24h',
        issuer: 'admin-panel',
        audience: 'admin-users'
      }
    );

    console.log('JWT token generated successfully');

    // Return user data and token
    res.json({
      token,
      user: {
        id: profile.profiles_id,
        email: profile.email,
        firstname: profile.firstname,
        lastname: profile.lastname,
        role: profile.role,
        profile_photo: profile.profile_photo
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout route
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Update user status to inactive
    const userId = req.user.userId;
    console.log('Logging out user ID:', userId);
    
    const updateResult = await supabaseAdmin
      .from('profiles')
      .update({ status: 'inactive' })
      .eq('profiles_id', userId);

    if (updateResult.error) {
      console.error('Error updating user status on logout:', updateResult.error);
      console.error('Update error details:', JSON.stringify(updateResult, null, 2));
      return res.status(500).json({ error: 'Failed to update user status' });
    } else {
      console.log('User status updated successfully to inactive for user ID:', userId);
    }

    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Beacon-style logout route for handling browser close events
router.options('/logout', (req, res) => {
  // Handle CORS preflight for sendBeacon
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

router.post('/logout-beacon', async (req, res) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    let token = authHeader ? authHeader.split(' ')[1] : null;
    
    // If no auth header was sent, try to get from request body
    if (!token && req.body && req.body.token) {
      token = req.body.token;
    }

    if (!token) {
      return res.sendStatus(204); // No token, no content
    }

    try {
      // Verify token and extract user ID
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.userId || decoded.sub;
      
      if (userId) {
        // Update status to inactive
        await supabaseAdmin
          .from('profiles')
          .update({ status: 'inactive' })
          .eq('profiles_id', userId);
      }
    } catch (tokenError) {
      console.error('Token error in logout-beacon:', tokenError);
      // Ignore token errors for beacon requests, just return success
    }

    // Always return 204 No Content for beacon requests
    res.sendStatus(204);
  } catch (error) {
    console.error('Beacon logout error:', error);
    res.sendStatus(204); // Always return success for beacon
  }
});

// Auth status check endpoint to update user status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('Checking auth status for user ID:', userId);
    
    // Update user status to active whenever this endpoint is called
    console.log('Updating user status to active from /status endpoint');
    const updateResult = await supabaseAdmin
      .from('profiles')
      .update({ status: 'active' })
      .eq('profiles_id', userId);

    if (updateResult.error) {
      console.error('Error updating user status on status check:', updateResult.error);
      console.error('Update error details:', JSON.stringify(updateResult, null, 2));
      // Continue with status check even if update fails
    } else {
      console.log('User status updated successfully to active from status endpoint');
    }

    res.json({ 
      authenticated: true, 
      user: {
        id: userId,
        email: req.user.email,
        role: req.user.role
      } 
    });
  } catch (error) {
    console.error('Auth status check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
