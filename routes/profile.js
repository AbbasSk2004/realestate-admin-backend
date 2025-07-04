const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { authenticateToken } = require('../middleware/auth');
const { supabase, supabaseAdmin } = require('../config/database');
const { createClient } = require('@supabase/supabase-js');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/profiles');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename with timestamp and original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'profile-' + uniqueSuffix + ext);
  }
});

// File filter for images only
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Get current user profile
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select(
        'id, profiles_id, firstname, lastname, email, profile_photo, phone, role, status, created_at, updated_at, last_login'
      )
      .eq('profiles_id', userId)
      .single();

    if (error || !profile) {
      return res.status(404).json({ success: false, message: 'Profile not found', error: error?.message });
    }

    res.json(profile);
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching profile', error: error.message });
  }
});

// Update user profile
router.put('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { firstname, lastname, phone } = req.body;

    if (!firstname || !lastname) {
      return res.status(400).json({ success: false, message: 'First name and last name are required' });
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ firstname, lastname, phone: phone || null, updated_at: new Date().toISOString() })
      .eq('profiles_id', userId)
      .select()
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Profile not found', error: error?.message });
    }

    res.json(data);
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ success: false, message: 'Server error while updating profile', error: error.message });
  }
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long' });
    }

    // Fetch user email
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('email')
      .eq('profiles_id', userId)
      .single();

    if (profErr || !profile) {
      return res.status(404).json({ success: false, message: 'User not found', error: profErr?.message });
    }

    // Debug logging
    console.log('Password change attempt - Current password verified successfully');
    console.log('User ID:', userId);
    console.log('Email:', profile.email);
    console.log('Attempting to update password with admin API...');
    console.log('SUPABASE_SERVICE_ROLE_KEY exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Create a fresh admin client to ensure we're using the right key
    const freshAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );
    
    console.log('Created fresh admin client');
    
    // Test if the admin client can perform a simple operation
    try {
      const { data: testData, error: testError } = await freshAdmin.auth.getUser();
      if (testError) {
        console.error('Admin client test failed:', testError);
      } else {
        console.log('Admin client test succeeded - can access auth API');
      }
    } catch (testErr) {
      console.error('Admin client test threw exception:', testErr);
    }
    
    const { error: updErr } = await freshAdmin.auth.admin.updateUserById(
      userId, 
      { password: newPassword }
    );

    // Debug the update result
    if (updErr) {
      console.error('Password update failed:', updErr);
      return res.status(500).json({ success: false, message: 'Failed to change password', error: updErr.message });
    } else {
      console.log('Password update API call succeeded');
    }

    // Everything looks good – inform the client
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ success: false, message: 'Server error while changing password', error: error.message });
  }
});

// Upload profile photo
router.post('/upload-photo', authenticateToken, upload.single('profilePhoto'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }
    
    const userId = req.user.userId;
    
    // Get the relative path to the uploaded file
    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
    const relativePath = req.file.path.replace(/\\/g, '/').split('/uploads/')[1];
    const photoUrl = `${baseUrl}/uploads/${relativePath}`;
    
    // Update profile photo URL in database
    const query = `
      UPDATE profiles
      SET 
        profile_photo = $1,
        updated_at = NOW()
      WHERE profiles_id = $2
      RETURNING *
    `;
    
    const result = await db.query(query, [photoUrl, userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Profile photo updated successfully',
      photoUrl: photoUrl,
      profile: result.rows[0]
    });
  } catch (error) {
    console.error('Error uploading profile photo:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while uploading profile photo',
      error: error.message
    });
  }
});

module.exports = router;
