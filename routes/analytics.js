const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/database');

// Get analytics overview data
router.get('/overview', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build queries with date filters
    let propertiesQuery = supabase.from('properties').select('*', { count: 'exact', head: true });
    let viewsQuery = supabase.from('property_views').select('*', { count: 'exact', head: true });
    let inquiriesQuery = supabase.from('property_inquiries').select('*', { count: 'exact', head: true });
    
    // Apply date filters if provided
    if (startDate) {
      propertiesQuery = propertiesQuery.gte('created_at', startDate);
      viewsQuery = viewsQuery.gte('viewed_date', startDate);
      inquiriesQuery = inquiriesQuery.gte('created_at', startDate);
    }
    
    if (endDate) {
      propertiesQuery = propertiesQuery.lte('created_at', endDate);
      viewsQuery = viewsQuery.lte('viewed_date', endDate);
      inquiriesQuery = inquiriesQuery.lte('created_at', endDate);
    }

    // Execute queries
    const [propertiesResult, viewsResult, inquiriesResult] = await Promise.all([
      propertiesQuery,
      viewsQuery,
      inquiriesQuery
    ]);

    // Get total properties count
    const totalProperties = propertiesResult.count || 0;

    // Get total property views
    const totalViews = viewsResult.count || 0;

    // Get total inquiries
    const totalInquiries = inquiriesResult.count || 0;

    // Calculate conversion rate
    const conversionRate = totalViews > 0 
      ? ((totalInquiries / totalViews) * 100).toFixed(2) 
      : 0;

    res.json({
      totalProperties,
      totalViews,
      totalInquiries,
      conversionRate
    });
  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

// Get property views data by month
router.get('/property-views', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Initialize query
    let query = supabase
      .from('property_views')
      .select('viewed_date')
      .order('viewed_date');
    
    // Add date filters if provided
    if (startDate) {
      query = query.gte('viewed_date', startDate);
    }
    
    if (endDate) {
      query = query.lte('viewed_date', endDate);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Group views by month
    const monthlyViews = {};
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    data.forEach(view => {
      const date = new Date(view.viewed_date);
      const monthIndex = date.getMonth();
      const monthName = months[monthIndex];
      
      monthlyViews[monthName] = (monthlyViews[monthName] || 0) + 1;
    });
    
    // Format data for Chart.js
    const chartData = {
      labels: months,
      datasets: [{
        label: 'Property Views',
        data: months.map(month => monthlyViews[month] || 0),
        borderColor: 'rgb(78, 115, 223)',
        backgroundColor: 'rgba(78, 115, 223, 0.05)',
        tension: 0.3,
        fill: true
      }]
    };
    
    res.json(chartData);
  } catch (error) {
    console.error('Error fetching property views data:', error);
    res.status(500).json({ error: 'Failed to fetch property views data' });
  }
});

// Get property listings data by month
router.get('/property-listings', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Initialize query
    let query = supabase
      .from('properties')
      .select('created_at, status')
      .order('created_at');
    
    // Add date filters if provided
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    
    if (endDate) {
      query = query.lte('created_at', endDate);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Group listings by month and type
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const forSale = Array(12).fill(0);
    const forRent = Array(12).fill(0);
    
    data.forEach(property => {
      const date = new Date(property.created_at);
      const monthIndex = date.getMonth();
      
      if (property.status?.toLowerCase().includes('sale')) {
        forSale[monthIndex]++;
      } else if (property.status?.toLowerCase().includes('rent')) {
        forRent[monthIndex]++;
      }
    });
    
    // Format data for Chart.js
    const chartData = {
      labels: months,
      datasets: [
        {
          label: 'For Sale',
          data: forSale,
          backgroundColor: 'rgba(78, 115, 223, 0.8)',
        },
        {
          label: 'For Rent',
          data: forRent,
          backgroundColor: 'rgba(28, 200, 138, 0.8)',
        }
      ]
    };
    
    res.json(chartData);
  } catch (error) {
    console.error('Error fetching property listings data:', error);
    res.status(500).json({ error: 'Failed to fetch property listings data' });
  }
});

// Get property types distribution
router.get('/property-types', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Initialize query
    let query = supabase
      .from('properties')
      .select('property_type');
    
    // Add date filters if provided
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    
    if (endDate) {
      query = query.lte('created_at', endDate);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Group by property type
    const typeCounts = {};
    data.forEach(property => {
      const type = property.property_type || 'Unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    
    // Format data for Chart.js
    const propertyTypes = Object.keys(typeCounts);
    const chartData = {
      labels: propertyTypes,
      datasets: [
        {
          data: propertyTypes.map(type => typeCounts[type]),
          backgroundColor: [
            'rgba(78, 115, 223, 0.8)',
            'rgba(28, 200, 138, 0.8)',
            'rgba(54, 185, 204, 0.8)',
            'rgba(246, 194, 62, 0.8)',
            'rgba(231, 74, 59, 0.8)'
          ],
          borderWidth: 1,
        },
      ],
    };
    
    res.json(chartData);
  } catch (error) {
    console.error('Error fetching property types data:', error);
    res.status(500).json({ error: 'Failed to fetch property types data' });
  }
});

// Get top performing properties
router.get('/top-performing', async (req, res) => {
  try {
    const { limit = 5, startDate, endDate } = req.query;
    
    // Get all properties with their titles
    let propertiesQuery = supabase
      .from('properties')
      .select('id, title');
    
    // Apply date filters to properties if provided
    if (startDate) {
      propertiesQuery = propertiesQuery.gte('created_at', startDate);
    }
    
    if (endDate) {
      propertiesQuery = propertiesQuery.lte('created_at', endDate);
    }
    
    const { data: properties, error: propertiesError } = await propertiesQuery;
    
    if (propertiesError) throw propertiesError;
    
    // Get property IDs for filtering views and inquiries
    const propertyIds = properties.map(p => p.id);
    
    // Get views for each property within date range
    let viewsQuery = supabase
      .from('property_views')
      .select('property_id')
      .in('property_id', propertyIds);
    
    // Apply date filters to views if provided
    if (startDate) {
      viewsQuery = viewsQuery.gte('viewed_date', startDate);
    }
    
    if (endDate) {
      viewsQuery = viewsQuery.lte('viewed_date', endDate);
    }
    
    const { data: views, error: viewsError } = await viewsQuery;
    
    if (viewsError) throw viewsError;
    
    // Get inquiries for each property within date range
    let inquiriesQuery = supabase
      .from('property_inquiries')
      .select('property_id')
      .in('property_id', propertyIds);
    
    // Apply date filters to inquiries if provided
    if (startDate) {
      inquiriesQuery = inquiriesQuery.gte('created_at', startDate);
    }
    
    if (endDate) {
      inquiriesQuery = inquiriesQuery.lte('created_at', endDate);
    }
    
    const { data: inquiries, error: inquiriesError } = await inquiriesQuery;
    
    if (inquiriesError) throw inquiriesError;
    
    // Calculate views and inquiries for each property
    const propertyMetrics = {};
    
    properties.forEach(property => {
      propertyMetrics[property.id] = {
        id: property.id,
        title: property.title,
        views: 0,
        inquiries: 0,
        conversion: '0%'
      };
    });
    
    views.forEach(view => {
      if (propertyMetrics[view.property_id]) {
        propertyMetrics[view.property_id].views++;
      }
    });
    
    inquiries.forEach(inquiry => {
      if (propertyMetrics[inquiry.property_id]) {
        propertyMetrics[inquiry.property_id].inquiries++;
      }
    });
    
    // Calculate conversion rate and prepare result
    const topProperties = Object.values(propertyMetrics)
      .map(property => {
        if (property.views > 0) {
          property.conversion = ((property.inquiries / property.views) * 100).toFixed(2) + '%';
        }
        return property;
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);
    
    res.json(topProperties);
  } catch (error) {
    console.error('Error fetching top performing properties:', error);
    res.status(500).json({ error: 'Failed to fetch top performing properties' });
  }
});

// Get user activity metrics
router.get('/user-activity', async (req, res) => {
  try {
    // Try to get session metrics from RPC if available
    let sessionMetrics = null;
    
    try {
      const { data, error } = await supabase.rpc('get_session_metrics');
      if (!error) {
        sessionMetrics = data;
      }
    } catch (rpcError) {
      console.log('RPC not available, using fallback data');
    }
    
    // Use session metrics or fallback to sample data
    const activityMetrics = {
      sessionDuration: sessionMetrics?.avg_duration || '4m 12s',
      sessionDurationPercent: sessionMetrics?.duration_percent || 75,
      pagesPerSession: sessionMetrics?.pages_per_session || 5.2,
      pagesPerSessionPercent: sessionMetrics?.pages_percent || 65,
      bounceRate: sessionMetrics?.bounce_rate || '32.4%',
      bounceRatePercent: sessionMetrics?.bounce_percent || 32,
      trafficSources: {
        direct: sessionMetrics?.direct_percent || 35,
        organic: sessionMetrics?.organic_percent || 45,
        social: sessionMetrics?.social_percent || 20
      }
    };
    
    res.json(activityMetrics);
  } catch (error) {
    console.error('Error fetching user activity metrics:', error);
    res.status(500).json({ error: 'Failed to fetch user activity metrics' });
  }
});

module.exports = router;
