const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/database');

// Get all properties
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching properties:', err);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

// Get a single property
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select(`
        *,
        profiles:profiles_id (
          firstname,
          lastname,
          email,
          phone,
          profile_photo
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Property not found' });
    }

    // If the join didn't populate profile data (supabase join issue), fetch it manually
    if (!data.profiles) {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('firstname, lastname, email, phone, profile_photo')
        .eq('profiles_id', data.profiles_id)
        .single();

      if (profileError) {
        console.warn('Profile fetch fallback error:', profileError);
      } else {
        data.profiles = profileData;
      }
    }

    // Log the property data to verify retail fields and profiles presence
    // console.log('Retrieved property data:', {
    //   id: data.id,
    //   property_type: data.property_type,
    //   shop_front_width: data.shop_front_width,
    //   storage_area: data.storage_area,
    //   hasProfiles: !!data.profiles,
    //   profiles: data.profiles
    // });

    res.json(data);
  } catch (err) {
    console.error('Error fetching property:', err);
    res.status(500).json({ error: 'Failed to fetch property' });
  }
});

// Create a new property
router.post('/', async (req, res) => {
  try {
    // For new properties, we'll still require essential fields
    const requiredFields = ['title', 'price', 'status', 'property_type'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Ensure the property is associated with the current user unless explicitly provided
    const insertPayload = {
      ...req.body,
      profiles_id: req.body.profiles_id || req.user?.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('properties')
      .insert([insertPayload])
      .select();

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (err) {
    console.error('Error creating property:', err);
    res.status(500).json({ error: 'Failed to create property' });
  }
});

// Update a property - now handles partial updates
router.put('/:id', async (req, res) => {
  try {
    // console.log('Received update data:', {
    //   floor: req.body.floor,
    //   garden_area: req.body.garden_area,
    //   body: req.body
    // });

    // Get the current property data
    const { data: existingProperty, error: fetchError } = await supabase
      .from('properties')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError) throw fetchError;
    if (!existingProperty) {
      return res.status(404).json({ error: 'Property not found' });
    }

    // Clean and prepare the update data
    const updateData = {
      title: req.body.title,
      property_type: req.body.property_type,
      status: req.body.status,
      price: req.body.price,
      governate: req.body.governate,
      city: req.body.city,
      village: req.body.village,
      address: req.body.address,
      bedrooms: req.body.bedrooms,
      bathrooms: req.body.bathrooms,
      parking_spaces: req.body.parking_spaces,
      area: req.body.area,
      year_built: req.body.year_built,
      furnishing_status: req.body.furnishing_status,
      description: req.body.description,
      verified: req.body.verified,
      is_featured: req.body.is_featured,
      recommended: req.body.recommended,
      livingrooms: req.body.livingrooms,
      floor: req.body.floor,
      garden_area: req.body.garden_area,
      location_url: req.body.location_url,
      features: req.body.features || existingProperty.features,
      shop_front_width: req.body.shop_front_width,
      storage_area: req.body.storage_area,
      ceiling_height: req.body.ceiling_height,
      loading_docks: req.body.loading_docks,
      office_layout: req.body.office_layout,
      meeting_rooms: req.body.meeting_rooms,
      water_source: req.body.water_source,
      crop_types: req.body.crop_types,
      updated_at: new Date().toISOString()
    };

    // console.log('Initial updateData:', {
    //   floor: updateData.floor,
    //   garden_area: updateData.garden_area,
    //   office_layout: updateData.office_layout,
    //   meeting_rooms: updateData.meeting_rooms
    // });

    // Explicitly handle null values for numeric fields
    ['floor', 'garden_area', 'bedrooms', 'bathrooms', 'livingrooms', 'parking_spaces', 'year_built', 'units', 'elevators', 'shop_front_width', 'storage_area', 'ceiling_height', 'loading_docks', 'meeting_rooms'].forEach(field => {
      if (req.body[field] === null || req.body[field] === '' || req.body[field] === undefined) {
        updateData[field] = null;
      } else {
        // Use parseInt for integer fields and parseFloat for decimal fields
        if (['garden_area', 'shop_front_width', 'storage_area', 'ceiling_height'].includes(field)) {
          updateData[field] = parseFloat(req.body[field]);
        } else if (field === 'floor') {
          // Handle floor field based on property type
          const floorValue = req.body[field] !== '' && req.body[field] !== null ? parseInt(req.body[field]) : null;
          
          if (floorValue === null) {
            updateData[field] = null;
          } else if (req.body.property_type === 'Apartment') {
            // For Apartments, allow any non-negative integer
            updateData[field] = floorValue >= 0 ? floorValue : null;
          } else if (req.body.property_type === 'Villa' || req.body.property_type === 'Building') {
            // For Villa and Building types, ensure floor is a positive integer
            updateData[field] = floorValue >= 1 ? floorValue : null;
          } else {
            updateData[field] = floorValue;
          }
          
          // console.log('Processing floor value:', {
          //   input: req.body[field],
          //   parsed: floorValue,
          //   final: updateData[field],
          //   propertyType: req.body.property_type
          // });
        } else {
          updateData[field] = parseInt(req.body[field]);
        }
      }
    });

    // Handle empty values for Farm-specific string fields
    ['water_source', 'crop_types'].forEach(field => {
      if (req.body[field] === '' || req.body[field] === undefined) {
        updateData[field] = null;
      }
    });

    // console.log('Final updateData after processing:', {
    //   floor: updateData.floor,
    //   property_type: updateData.property_type,
    //   allData: updateData
    // });

    // Handle features separately to ensure proper JSONB format
    if (req.body.features) {
      updateData.features = {
        ...existingProperty.features,
        ...req.body.features
      };
    }

    // Remove undefined values but keep null values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Handle images separately
    if (req.body.images) {
      if (req.body.images.main) {
        updateData.main_image = req.body.images.main;
      }
      if (req.body.images.additional) {
        updateData.images = req.body.images.additional;
      }
    }

    const { data, error } = await supabase
      .from('properties')
      .update(updateData)
      .eq('id', req.params.id)
      .select();

    // console.log('Supabase response:', { data, error });

    if (error) {
      console.error('Supabase update error:', error);
      throw error;
    }
    
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }
    
    res.json(data[0]);
  } catch (err) {
    console.error('Error updating property:', err);
    res.status(500).json({ error: 'Failed to update property', details: err.message });
  }
});

// Delete a property
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('properties')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting property:', err);
    res.status(500).json({ error: 'Failed to delete property' });
  }
});

module.exports = router;
