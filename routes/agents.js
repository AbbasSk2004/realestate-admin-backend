const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/database');

// Get all approved agents
router.get('/approved', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('agents')
      .select(`
        *,
        profiles:profiles(
          firstname,
          lastname,
          email,
          profile_photo,
          phone
        )
      `)
      .eq('approved', true)
      .eq('status', 'approved')
      .order('is_featured', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching approved agents:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all agent applications (excluding approved agents)
router.get('/applications', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('agents')
      .select(`
        *,
        profiles:profiles(
          firstname,
          lastname,
          email,
          profile_photo,
          phone
        )
      `)
      .not('status', 'eq', 'approved')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching agent applications:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update agent application status - supports both PATCH and PUT
router.patch('/applications/:id', async (req, res) => {
  const { id } = req.params;
  const { status, approved, approved_at } = req.body;

  try {
    const updateData = {
      status,
      approved,
      approved_at: status === 'approved' ? (approved_at || new Date().toISOString()) : null
    };

    const { data, error } = await supabase
      .from('agents')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        profiles:profiles(
          firstname,
          lastname,
          email,
          profile_photo,
          phone
        )
      `)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error updating agent application:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update agent feature status - supports both PATCH and PUT
router.route('/agents/:id/feature')
  .patch(async (req, res) => {
    const { id } = req.params;
    const { is_featured } = req.body;

    try {
      const { data, error } = await supabase
        .from('agents')
        .update({ is_featured })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('Error updating agent feature status:', err);
      res.status(500).json({ error: err.message });
    }
  })
  .put(async (req, res) => {
    const { id } = req.params;
    const { is_featured } = req.body;

    try {
      const { data, error } = await supabase
        .from('agents')
        .update({ is_featured })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('Error updating agent feature status:', err);
      res.status(500).json({ error: err.message });
    }
  });

// Update agent details - supports both PATCH and PUT
router.route('/agents/:id')
  .patch(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    try {
      const { data, error } = await supabase
        .from('agents')
        .update(updateData)
        .eq('id', id)
        .select(`
          *,
          profiles:profiles(
            firstname,
            lastname,
            email,
            profile_photo,
            phone
          )
        `)
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('Error updating agent:', err);
      res.status(500).json({ error: err.message });
    }
  })
  .put(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    try {
      const { data, error } = await supabase
        .from('agents')
        .update(updateData)
        .eq('id', id)
        .select(`
          *,
          profiles:profiles(
            firstname,
            lastname,
            email,
            profile_photo,
            phone
          )
        `)
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error('Error updating agent:', err);
      res.status(500).json({ error: err.message });
    }
  })
  .delete(async (req, res) => {
    const { id } = req.params;

    try {
      const { error } = await supabase
        .from('agents')
        .delete()
        .eq('id', id);

      if (error) throw error;
      res.json({ message: 'Agent deleted successfully' });
    } catch (err) {
      console.error('Error deleting agent:', err);
      res.status(500).json({ error: err.message });
    }
  });

module.exports = router;
