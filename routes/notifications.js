const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Helper function to check notification settings
async function shouldSendNotification(adminId, notificationType) {
  try {
    const { data: settings, error } = await supabase
      .from('settings')
      .select('settings_data')
      .eq('section', 'notifications')
      .single();

    if (error) {
      console.error('Error fetching notification settings:', error);
      return true; // Default to sending if can't fetch settings
    }

    const notificationSettings = settings?.settings_data || {};

    // Check if notifications are enabled at all
    if (!notificationSettings.enableEmailNotifications && !notificationSettings.enableBrowserNotifications) {
      return false;
    }

    // Check specific notification types
    switch (notificationType) {
      case 'inquiry':
        return notificationSettings.notifyOnNewInquiry !== false;
      case 'user':
        return notificationSettings.notifyOnNewUser !== false;
      case 'property':
        return notificationSettings.notifyOnPropertyChange !== false;
      default:
        return true;
    }
  } catch (error) {
    console.error('Error checking notification settings:', error);
    return true; // Default to sending if error occurs
  }
}

// Store active channels by user ID to prevent duplicates
const activeChannels = new Map();

// SSE endpoint for real-time notifications
router.get('/stream', authenticateToken, (req, res) => {
  // Debug log successful authentication
  console.log('SSE Stream: Authentication successful for user:', req.user.userId);

  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization',
    'X-Accel-Buffering': 'no' // Disable Nginx buffering
  });

  // Send initial connection message with user ID for debugging
  res.write(`data: ${JSON.stringify({ type: 'connected', userId: req.user.userId })}\n\n`);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(keepAlive);
      return;
    }
    try {
      res.write(': keepalive\n\n');
    } catch (error) {
      console.error('Error sending keepalive:', error);
      clearInterval(keepAlive);
      cleanup();
    }
  }, 30000); // Send keepalive every 30 seconds

  let channelName = `admin_notifications_${req.user.userId}`;
  let subscription;

  const setupSubscription = () => {
    try {
      // Check if there's already an active channel for this user
      if (activeChannels.has(req.user.userId)) {
        console.log(`Removing existing channel for user: ${req.user.userId}`);
        try {
          // Try to remove the existing channel
          const existingChannel = activeChannels.get(req.user.userId);
          supabase.removeChannel(existingChannel);
        } catch (err) {
          console.error('Error removing existing channel:', err);
        }
        activeChannels.delete(req.user.userId);
      }

      console.log('Setting up Supabase subscription for user:', req.user.userId);
      
      // Subscribe to Supabase real-time notifications for admin
      subscription = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'admin_notifications',
            filter: `admin_id=eq.${req.user.userId}`
          },
          (payload) => {
            if (res.writableEnded) return;
            
            try {
              console.log('Received notification payload:', payload);
              
              // Format the notification
              const notification = {
                id: payload.new.id,
                type: payload.new.type || 'system',
                title: payload.new.title,
                message: payload.new.message,
                action_url: payload.new.action_url,
                read: false,
                created_at: payload.new.created_at || new Date().toISOString()
              };
              
              console.log('Sending notification to client:', notification);
              res.write(`data: ${JSON.stringify(notification)}\n\n`);
            } catch (error) {
              console.error('Error sending notification:', error);
            }
          }
        )
        .subscribe((status) => {
          console.log('Supabase subscription status:', status);
          if (status === 'SUBSCRIBED') {
            console.log('Successfully subscribed to notifications for user:', req.user.userId);
            // Store the active channel
            activeChannels.set(req.user.userId, subscription);
          } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
            console.error('Subscription failed with status:', status);
            // Remove from active channels on error
            activeChannels.delete(req.user.userId);
          }
        });
    } catch (error) {
      console.error('Error setting up subscription:', error);
      activeChannels.delete(req.user.userId);
    }
  };

  const cleanup = () => {
    if (subscription) {
      try {
        console.log(`Removing channel ${channelName} for user ${req.user.userId}`);
        supabase.removeChannel(subscription);
        activeChannels.delete(req.user.userId);
      } catch (error) {
        console.error('Error removing channel:', error);
      }
    }
    if (!res.writableEnded) {
      res.end();
    }
  };

  // Set up initial subscription
  setupSubscription();

  // Handle client disconnect
  req.on('close', () => {
    console.log(`Client disconnected: ${req.user.userId}`);
    clearInterval(keepAlive);
    cleanup();
  });

  // Handle errors
  res.on('error', (error) => {
    console.error('SSE Response error:', error);
    clearInterval(keepAlive);
    cleanup();
  });

  // Handle request timeout
  req.on('timeout', () => {
    console.error('Request timeout');
    clearInterval(keepAlive);
    cleanup();
  });
});

// Debug endpoint to test authentication
router.get('/debug-auth', authenticateToken, (req, res) => {
  try {
    console.log('Debug auth endpoint - user authenticated successfully');
    console.log('Debug auth endpoint - user data:', {
      userId: req.user.userId,
      role: req.user.role,
      email: req.user.email
    });
    
    res.json({
      success: true,
      message: 'Authentication successful',
      user: {
        userId: req.user.userId,
        role: req.user.role,
        email: req.user.email
      },
      headers: {
        authorization: req.headers.authorization ? 'Present' : 'Missing'
      },
      query: {
        token: req.query.token ? 'Present' : 'Missing'
      }
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get admin's notifications
router.get('/', async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      console.error('No user ID found in request:', req.user);
      return res.status(401).json({ error: 'User not authenticated or ID missing' });
    }

    // Optional limit (defaults to all). Offset-based pagination is no longer required.
    // If a numeric "limit" query param is provided we will respect it, otherwise return all notifications.
    let { limit } = req.query;
    limit = parseInt(limit, 10);

    if (Number.isNaN(limit) || limit <= 0) {
      limit = null; // Indicates no limit – fetch all records
    }

    console.log(`Fetching notifications for admin ID: ${req.user.userId}`);
    if (limit) {
      console.log(`Applying limit ${limit}`);
    }
    
    // First check if the user exists and has admin role
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('profiles_id', req.user.userId)
      .single();

    if (profileError) {
      console.error('Error fetching user profile:', profileError);
      return res.status(500).json({ error: 'Failed to verify user role' });
    }

    if (!userProfile || userProfile.role !== 'admin') {
      console.error('User is not an admin:', req.user.userId);
      return res.status(403).json({ error: 'User is not authorized to access admin notifications' });
    }

    console.log('Verified admin role for user:', req.user.userId);
    
    let notificationsQuery = supabase
      .from('admin_notifications')
      .select('*')
      .eq('admin_id', req.user.userId)
      .order('created_at', { ascending: false });

    // Apply limit only if explicitly requested
    if (limit) {
      notificationsQuery = notificationsQuery.limit(limit);
    }

    const { data, error } = await notificationsQuery;

    if (error) {
      console.error('Error fetching notifications from database:', error);
      throw error;
    }

    res.json(data || []);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get unread notifications count
router.get('/unread/count', async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      console.error('No user ID found in request:', req.user);
      return res.status(401).json({ error: 'User not authenticated or ID missing' });
    }

    console.log(`Fetching unread count for admin ID: ${req.user.userId}`);
    
    const { count, error } = await supabase
      .from('admin_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('admin_id', req.user.userId)
      .eq('read', false);

    if (error) throw error;

    res.json({ count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// Mark notification as read
router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('admin_notifications')
      .update({ read: true })
      .eq('id', id)
      .eq('admin_id', req.user.userId)
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
router.put('/read/all', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_notifications')
      .update({ read: true })
      .eq('admin_id', req.user.userId)
      .eq('read', false);

    if (error) throw error;

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// Delete all notifications for a user
router.delete('/all', async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { error } = await supabase
      .from('admin_notifications')
      .delete()
      .eq('admin_id', req.user.userId);

    if (error) {
      console.error('Supabase error deleting all notifications:', error);
      throw error;
    }

    res.json({ success: true, message: 'All notifications deleted successfully' });
  } catch (error) {
    console.error('Error deleting all notifications:', error);
    res.status(500).json({ error: 'Failed to delete all notifications' });
  }
});

// Delete a specific notification
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!id) {
      return res.status(400).json({ error: 'Notification ID is required' });
    }

    const { error } = await supabase
      .from('admin_notifications')
      .delete()
      .eq('id', id)
      .eq('admin_id', req.user.userId);

    if (error) {
      console.error('Supabase error deleting notification:', error);
      throw error;
    }

    res.json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router; 