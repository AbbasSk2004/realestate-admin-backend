const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');

// Get all inquiries with filters
router.get('/', async (req, res) => {
  try {
    const { searchTerm, status } = req.query;
    console.log('Received query params:', { searchTerm, status });
    
    let query = supabase
      .from('property_inquiries')
      .select(`
        id,
        message,
        status,
        created_at,
        properties!inner (
          id,
          title
        ),
        profiles!inner (
          firstname,
          lastname,
          email,
          phone
        )
      `);

    // Apply filters if provided
    if (searchTerm) {
      query = query.or([
        `profiles.firstname.ilike.%${searchTerm}%`,
        `profiles.lastname.ilike.%${searchTerm}%`,
        `properties.title.ilike.%${searchTerm}%`
      ].join(','));
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Order by most recent first
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Supabase query error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return res.status(500).json({ 
        error: 'Database query failed',
        details: error.message,
        code: error.code
      });
    }

    if (!data) {
      console.log('No data returned from query');
      return res.json([]);
    }

    console.log('Raw data from database:', data);

    // Transform data to match frontend structure
    const transformedData = data.map(inquiry => {
      const profile = inquiry.profiles || {};
      const property = inquiry.properties || {};
      
      return {
        id: inquiry.id,
        name: `${profile.firstname || ''} ${profile.lastname || ''}`.trim() || 'Unknown',
        email: profile.email || '',
        phone: profile.phone || '',
        subject: property.title ? `Interest in ${property.title}` : 'Property Inquiry',
        message: inquiry.message || '',
        property: property.title || 'Unknown Property',
        property_id: property.id,
        status: inquiry.status || 'New',
        date: new Date(inquiry.created_at).toLocaleString(),
        replied: inquiry.status !== 'New'
      };
    });

    console.log('Transformed data:', transformedData);
    res.json(transformedData);
  } catch (error) {
    console.error('Server error:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Failed to fetch inquiries', 
      details: error.message 
    });
  }
});

// Update inquiry status
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { data, error } = await supabase
      .from('property_inquiries')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Status update error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return res.status(500).json({ error: 'Failed to update status' });
    }

    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to update inquiry status' });
  }
});

// Delete inquiry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('property_inquiries')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Delete error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return res.status(500).json({ error: 'Failed to delete inquiry' });
    }

    res.json({ message: 'Inquiry deleted successfully' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to delete inquiry' });
  }
});

// Reply to inquiry
router.post('/:id/reply', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    // Update the inquiry status
    const { data, error } = await supabase
      .from('property_inquiries')
      .update({ 
        status: 'In Progress',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Reply update error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return res.status(500).json({ error: 'Failed to update inquiry status' });
    }

    // Here you would typically also send the email
    // This is a placeholder for email sending logic
    
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Failed to reply to inquiry' });
  }
});

module.exports = router;
