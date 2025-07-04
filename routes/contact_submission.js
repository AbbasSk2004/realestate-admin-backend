const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');

// Get all contact submissions
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contact_submissions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching contact submissions:', err);
    res.status(500).json({ error: 'Failed to fetch contact submissions' });
  }
});

// Create a new contact submission
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, message, preferred_contact } = req.body;
    const { data, error } = await supabase
      .from('contact_submissions')
      .insert([
        { name, email, phone, message, preferred_contact }
      ])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('Error creating contact submission:', err);
    res.status(500).json({ error: 'Failed to create contact submission' });
  }
});

// Update contact submission status
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const { data, error } = await supabase
      .from('contact_submissions')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error updating contact submission status:', err);
    res.status(500).json({ error: 'Failed to update contact submission status' });
  }
});

// Delete a contact submission
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('contact_submissions')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Contact submission deleted successfully' });
  } catch (err) {
    console.error('Error deleting contact submission:', err);
    res.status(500).json({ error: 'Failed to delete contact submission' });
  }
});

module.exports = router;
