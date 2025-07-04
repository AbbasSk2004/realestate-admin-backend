const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication middleware to ensure user is logged in
router.use(authenticateToken);

// Cache mechanism to prevent excessive database queries
const statsCache = {
  data: null,
  timestamp: 0,
  cacheDuration: 4000, // 4 seconds cache duration (slightly less than frontend interval)
};

// Get recent verified properties from the last 20 days
router.get('/recent-properties', async (req, res) => {
  try {
    const twentyDaysAgo = new Date();
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);

    const { data, error } = await supabase
      .from('properties')
      .select('id, title, status, price, created_at')
      .eq('verified', true)
      .gte('created_at', twentyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Error fetching recent properties:', err);
    res.status(500).json({ error: 'Failed to fetch recent properties' });
  }
});

// Get dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    // Check if we have a valid cached response
    const now = Date.now();
    if (statsCache.data && (now - statsCache.timestamp < statsCache.cacheDuration)) {
      console.log('Serving dashboard stats from cache');
      return res.json(statsCache.data);
    }

    // In case req.user is not set by middleware, fail gracefully
    if (!req.user) {
      console.warn('User information missing in dashboard stats request');
    }

    console.log('Fetching fresh dashboard stats from database');

    // Get total verified properties count
    let totalProperties = 0;
    let activeUsers = 0;
    let pendingPropertyInquiries = 0;
    let pendingContactSubmissions = 0;

    // Set a timeout to ensure the database queries don't hang
    const timeout = setTimeout(() => {
      console.error('Dashboard queries timeout reached');
      res.status(408).json({ 
        error: 'Request timeout while fetching dashboard statistics',
        totalProperties: 0,
        activeUsers: 0,
        pendingInquiries: 0
      });
    }, 5000); // 5 second timeout

    try {
      // Run queries in parallel to improve performance
      const [propertiesQuery, usersQuery, propertyInquiriesQuery, contactSubmissionsQuery] = await Promise.all([
        // Get properties count
        supabase
          .from('properties')
          .select('id', { count: 'exact' })
          .eq('verified', true),
        
        // Get active users count
        supabase
          .from('profiles')
          .select('profiles_id', { count: 'exact' })
          .eq('status', 'active'),
        
        // Get pending property inquiries count
        supabase
          .from('property_inquiries')
          .select('id', { count: 'exact' })
          .eq('status', 'pending'),
        
        // Get pending contact submissions count
        supabase
          .from('contact_submissions')
          .select('id', { count: 'exact' })
          .eq('status', 'pending')
      ]);
      
      // Clear the timeout since we got responses
      clearTimeout(timeout);
      
      if (propertiesQuery.error) {
        console.error('Error fetching properties:', propertiesQuery.error);
      } else {
        totalProperties = propertiesQuery.count || 0;
      }

      if (usersQuery.error) {
        console.error('Error fetching users:', usersQuery.error);
      } else {
        activeUsers = usersQuery.count || 0;
      }

      if (propertyInquiriesQuery.error) {
        console.error('Error fetching property inquiries:', propertyInquiriesQuery.error);
      } else {
        pendingPropertyInquiries = propertyInquiriesQuery.count || 0;
      }

      if (contactSubmissionsQuery.error) {
        console.error('Error fetching contact submissions:', contactSubmissionsQuery.error);
      } else {
        pendingContactSubmissions = contactSubmissionsQuery.count || 0;
      }

      // Calculate total pending inquiries
      const totalPendingInquiries = pendingPropertyInquiries + pendingContactSubmissions;

      // Prepare response data
      const responseData = {
        totalProperties,
        activeUsers,
        pendingInquiries: totalPendingInquiries
      };

      // Update cache
      statsCache.data = responseData;
      statsCache.timestamp = now;

      // Send the response
      res.json(responseData);
    
    } catch (error) {
      // Clear the timeout if an error occurs
      clearTimeout(timeout);
      throw error; // Re-throw to be caught by outer try/catch
    }

  } catch (error) {
    console.error('Error in /dashboard/stats:', error);
    res.status(500).json({ 
      error: 'Failed to fetch dashboard statistics',
      details: error.message,
      totalProperties: 0,
      activeUsers: 0,
      pendingInquiries: 0
    });
  }
});

// Get recent inquiries from the last 20 days
router.get('/recent-inquiries', async (req, res) => {
  try {
    const twentyDaysAgo = new Date();
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);

    const { data, error } = await supabase
      .from('property_inquiries')
      .select(`
        id, 
        message,
        subject,
        status,
        created_at,
        profiles:profiles_id (firstname, lastname, email),
        property:property_id (title)
      `)
      .gte('created_at', twentyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    // Format the data for frontend consumption
    const formattedData = data.map(inquiry => ({
      id: inquiry.id,
      name: `${inquiry.profiles.firstname} ${inquiry.profiles.lastname}`.trim(),
      email: inquiry.profiles.email,
      property: inquiry.property ? inquiry.property.title : 'Unknown Property',
      date: inquiry.created_at,
      status: inquiry.status
    }));

    res.json(formattedData);
  } catch (err) {
    console.error('Error fetching recent inquiries:', err);
    res.status(500).json({ error: 'Failed to fetch recent inquiries' });
  }
});

// Get monthly earnings
router.get('/monthly-earnings', async (req, res) => {
  try {
    const currentDate = new Date();
    const startOfMonth = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1));
    const startOfNextMonth = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 1));

    const { data, error } = await supabase
      .from('payments')
      .select('amount')
      .eq('payment_status', 'completed')
      .gte('created_at', startOfMonth.toISOString())
      .lt('created_at', startOfNextMonth.toISOString());

    if (error) throw error;

    const payments = data || [];
    const totalEarnings = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    res.json(totalEarnings);
  } catch (err) {
    console.error('Error fetching monthly earnings:', err);
    res.status(500).json({ error: 'Failed to fetch monthly earnings' });
  }
});

// Get earnings overview for the last 6 months
router.get('/earnings-overview', async (req, res) => {
  try {
    const months = [];
    const earnings = [];
    const currentDate = new Date();

    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() - i, 1));
      const nextMonthStart = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() - i + 1, 1));

      const { data, error } = await supabase
        .from('payments')
        .select('amount')
        .eq('payment_status', 'completed')
        .gte('created_at', monthStart.toISOString())
        .lt('created_at', nextMonthStart.toISOString());

      if (error) throw error;

      const monthlyPayments = data || [];
      const monthlyTotal = monthlyPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      months.push(monthStart.toLocaleString('default', { month: 'short' }));
      earnings.push(monthlyTotal);
    }

    res.json({ months, earnings });
  } catch (err) {
    console.error('Error fetching earnings overview:', err);
    res.status(500).json({ months: [], earnings: [], error: 'Failed to fetch earnings overview' });
  }
});

module.exports = router;
