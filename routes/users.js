const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/database');
const { authenticateToken, isAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Apply authentication middleware to all routes
router.use(authenticateToken);
router.use(isAdmin);

// Error handling middleware
const handleError = (err, res) => {
  console.error('Detailed error:', {
    error: err,
    message: err.message,
    status: err.status,
    details: err.details,
    stack: err.stack
  });
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  const details = err.details || null;
  res.status(status).json({ error: message, details });
};

// Configure multer for memory storage (temporary storage before Supabase upload)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      const error = new Error('Only .jpeg, .png and .gif format allowed!');
      error.status = 400;
      return cb(error, false);
    }
    cb(null, true);
  }
});

// Constants for Supabase storage
const BUCKET_NAME = 'property-images';
const PROFILE_FOLDER = 'profiles';
const BASE_PATH = 'https://mmgfvjfgstcpqmlhctlw.supabase.co/storage/v1/object/public/property-images/profiles/';

// Get all users with optional search and filter
router.get('/', async (req, res) => {
  try {
    const { search, role } = req.query;
    let query = supabaseAdmin.from('profiles').select('*');

    // Apply role filter if provided
    if (role && role !== 'all') {
      query = query.eq('role', role.toLowerCase());
    }

    // Apply search filter if provided
    if (search) {
      query = query.or(`firstname.ilike.%${search}%,lastname.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Order by creation date
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) throw { ...error, status: 500 };
    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

// Create a new user in both auth.users and profiles
router.post('/', async (req, res) => {
  try {
    const { email, password, firstname, lastname, phone, role, profile_photo } = req.body;

    console.log('Creating new user with data:', {
      email,
      firstname,
      lastname,
      phone,
      role,
      hasPassword: !!password,
      hasPhoto: !!profile_photo
    });

    if (!email || !password || !firstname || !lastname) {
      throw { message: 'Missing required fields', status: 400 };
    }

    // First, create the user in auth.users using admin client
    console.log('Creating auth user...');
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true // Auto confirm the email
    });

    if (authError) {
      console.error('Auth user creation failed:', authError);
      throw { ...authError, status: 400 };
    }

    console.log('Auth user created successfully:', authUser.user.id);

    // Then, create the profile using admin client
    const newProfile = {
      profiles_id: authUser.user.id,
      firstname,
      lastname,
      email,
      phone,
      profile_photo,
      role: role || 'user',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Creating user profile:', newProfile);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert([newProfile])
      .select()
      .single();

    if (profileError) {
      console.error('Profile creation failed:', profileError);
      // If profile creation fails, delete the auth user
      console.log('Cleaning up auth user due to profile creation failure...');
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      throw { ...profileError, status: 400 };
    }

    console.log('User profile created successfully:', profile);
    res.status(201).json(profile);
  } catch (err) {
    handleError(err, res);
  }
});

// Get a single user
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('profiles_id', req.params.id)
      .single();

    if (error) throw { ...error, status: 500 };
    if (!data) {
      throw { message: 'User not found', status: 404 };
    }

    res.json(data);
  } catch (err) {
    handleError(err, res);
  }
});

// Update a user
router.put('/:id', async (req, res) => {
  try {
    console.log('Received update request for user:', {
      id: req.params.id,
      body: req.body
    });

    const updateData = {
      firstname: req.body.firstname,
      lastname: req.body.lastname,
      email: req.body.email,
      phone: req.body.phone,
      profile_photo: req.body.profile_photo,
      role: req.body.role,
      updated_at: new Date().toISOString()
    };

    // Remove undefined and null values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined || updateData[key] === null) {
        delete updateData[key];
      }
    });

    console.log('Cleaned update data:', updateData);

    // Validate required fields if they are being updated
    if (updateData.email && !updateData.email.includes('@')) {
      throw { message: 'Invalid email format', status: 400 };
    }

    // First check if user exists
    console.log('Checking if user exists...');
    const { data: existingUser, error: checkError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('profiles_id', req.params.id)
      .single();

    if (checkError) {
      console.error('Error checking user existence:', checkError);
      throw { ...checkError, status: 500 };
    }

    if (!existingUser) {
      console.error('User not found:', req.params.id);
      throw { message: 'User not found', status: 404 };
    }

    console.log('User found, proceeding with update...');

    // Perform the update with maybeSingle() to handle no results case
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('profiles_id', req.params.id)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Update error:', error);
      throw { ...error, status: 500 };
    }

    if (!data) {
      console.error('No data returned after update');
      // Instead of throwing an error, return the existing user data with updates
      const updatedUser = { ...existingUser, ...updateData };
      console.log('Returning updated user data:', updatedUser);
      return res.json(updatedUser);
    }

    console.log('Update successful:', data);
    res.json(data);
  } catch (err) {
    console.error('Error in update route:', {
      error: err,
      message: err.message,
      status: err.status,
      details: err.details
    });
    handleError(err, res);
  }
});

// Delete a user (admin only)
router.delete('/:id', async (req, res) => {
  try {
    // Delete the user profile first using service role to bypass RLS
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('profiles_id', req.params.id);

    if (profileError) {
      console.error('Error deleting profile:', profileError);
      throw { ...profileError, status: 500 };
    }

    // Delete the auth user using the Admin API (requires service role key)
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);

    if (authError) {
      console.error('Error deleting auth user:', authError);
      throw { ...authError, status: 500 };
    }

    res.status(204).send();
  } catch (err) {
    handleError(err, res);
  }
});

// Upload profile image
router.post('/upload-profile-image', upload.single('profile_image'), async (req, res) => {
  try {
    if (!req.file) {
      throw { message: 'No file uploaded', status: 400 };
    }

    // Generate a unique filename
    const fileExt = path.extname(req.file.originalname);
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}${fileExt}`;
    const filePath = `${PROFILE_FOLDER}/${fileName}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (error) throw error;

    // Return the full URL
    const imageUrl = `${BASE_PATH}${fileName}`;

    res.json({
      success: true,
      imageUrl: imageUrl,
      message: 'File uploaded successfully'
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      handleError({ message: 'File size cannot be larger than 5MB', status: 400 }, res);
    } else if (err.code === 'INVALID_FILE_TYPE') {
      handleError({ message: err.message, status: 400 }, res);
    } else {
      handleError(err, res);
    }
  }
});

// Delete profile image
router.delete('/delete-profile-image/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Delete from Supabase Storage
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([`${PROFILE_FOLDER}/${filename}`]);

    if (error) throw error;

    res.status(200).json({ message: 'File deleted successfully' });
  } catch (err) {
    console.error('Error deleting file:', err);
    handleError(err, res);
  }
});

module.exports = router;
