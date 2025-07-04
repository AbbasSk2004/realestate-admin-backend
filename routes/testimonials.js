const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');

// Get all testimonials
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('testimonials')
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
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching testimonials:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update testimonial approval status
router.patch('/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { approved } = req.body;

  try {
    const { data, error } = await supabase
      .from('testimonials')
      .update({ approved })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error updating testimonial:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete testimonial
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from('testimonials')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Testimonial deleted successfully' });
  } catch (err) {
    console.error('Error deleting testimonial:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
