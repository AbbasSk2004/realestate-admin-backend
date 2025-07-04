const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');

// Get all FAQs
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('faqs')
      .select('*')
      .order('order_number', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching FAQs:', err);
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

// Get FAQ categories
router.get('/categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('faqs')
      .select('category')
      .not('category', 'is', null);

    if (error) throw error;
    
    // Get unique categories
    const categories = [...new Set(data.map(faq => faq.category))];
    res.json(categories);
  } catch (err) {
    console.error('Error fetching FAQ categories:', err);
    res.status(500).json({ error: 'Failed to fetch FAQ categories' });
  }
});

// Create new FAQ
router.post('/', async (req, res) => {
  try {
    const { question, answer, category, is_featured, order_number } = req.body;

    // Validate required fields
    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }

    const newFaq = {
      question,
      answer,
      category,
      is_featured: is_featured || false,
      order_number: order_number || 0
    };

    const { data, error } = await supabase
      .from('faqs')
      .insert([newFaq])
      .select();

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (err) {
    console.error('Error creating FAQ:', err);
    res.status(500).json({ error: 'Failed to create FAQ' });
  }
});

// Update FAQ
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, category, is_featured, order_number } = req.body;

    // Validate required fields
    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }

    const updatedFaq = {
      question,
      answer,
      category,
      is_featured: is_featured || false,
      order_number: order_number || 0,
      updated_at: new Date()
    };

    const { data, error } = await supabase
      .from('faqs')
      .update(updatedFaq)
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (err) {
    console.error('Error updating FAQ:', err);
    res.status(500).json({ error: 'Failed to update FAQ' });
  }
});

// Delete FAQ
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('faqs')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'FAQ deleted successfully' });
  } catch (err) {
    console.error('Error deleting FAQ:', err);
    res.status(500).json({ error: 'Failed to delete FAQ' });
  }
});

module.exports = router;
