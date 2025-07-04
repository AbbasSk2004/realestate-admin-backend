const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/database');

// Record a view for a property and return updated count
router.post('/:id', async (req, res) => {
  try {
    const propertyId = req.params.id?.trim();
    if (!propertyId) {
      return res.status(400).json({ success: false, error: 'Invalid property ID' });
    }

    // Insert a new view (use admin client to bypass RLS if enabled)
    const { error: insertError } = await supabaseAdmin
      .from('property_views')
      .insert([
        {
          property_id: propertyId,
          viewed_date: new Date().toISOString(),
          user_id: req.user ? req.user.userId : null
        }
      ]);

    if (insertError) throw insertError;

    // Retrieve updated view count
    const { count, error: countError } = await supabase
      .from('property_views')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId);

    if (countError) throw countError;

    return res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('Error recording property view:', error);
    res.status(500).json({ success: false, error: 'Failed to record property view' });
  }
});

// Get total view count for a property without recording a new view
router.get('/:id', async (req, res) => {
  try {
    const propertyId = req.params.id?.trim();
    if (!propertyId) {
      return res.status(400).json({ success: false, error: 'Invalid property ID' });
    }

    const { count, error } = await supabase
      .from('property_views')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId);

    if (error) throw error;

    return res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('Error fetching property view count:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch property view count' });
  }
});

module.exports = router; 