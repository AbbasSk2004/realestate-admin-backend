const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/database');
const { randomUUID } = require('crypto');

// Bucket name where property images are stored
const IMAGE_BUCKET = 'property-images';

// Upload a base64 image string to Supabase Storage and return the public URL
async function uploadBase64Image(base64String, filenamePrefix = 'image') {
  // Expect format: data:image/<ext>;base64,<data>
  const matches = base64String.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid image data');
  }
  const contentType = matches[1];
  const base64Data = matches[2];

  const fileExt = contentType.split('/')[1];
  const fileName = `${filenamePrefix}-${randomUUID()}.${fileExt}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(IMAGE_BUCKET)
    .upload(fileName, Buffer.from(base64Data, 'base64'), {
      contentType,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
    error: urlError,
  } = supabaseAdmin.storage.from(IMAGE_BUCKET).getPublicUrl(fileName);

  if (urlError) throw urlError;

  return publicUrl;
}

// Remove a single image given its public URL
async function removeImageFromStorage(imageUrl) {
  if (!imageUrl) return;
  const idx = imageUrl.indexOf(`${IMAGE_BUCKET}/`);
  if (idx === -1) return; // malformed URL
  const path = imageUrl.substring(idx + IMAGE_BUCKET.length + 1);
  await supabaseAdmin.storage.from(IMAGE_BUCKET).remove([path]);
}

// Remove multiple images
async function removeImagesFromStorage(imageUrls = []) {
  const paths = imageUrls
    .map((url) => {
      const idx = url.indexOf(`${IMAGE_BUCKET}/`);
      if (idx === -1) return null;
      return url.substring(idx + IMAGE_BUCKET.length + 1);
    })
    .filter(Boolean);
  if (paths.length) {
    await supabaseAdmin.storage.from(IMAGE_BUCKET).remove(paths);
  }
}

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

    // Handle image uploads for new property
    let mainImageUrl = null;
    let additionalImageUrls = [];

    if (req.body.images) {
      const { main, additional } = req.body.images;

      if (main && typeof main === 'string') {
        mainImageUrl = await uploadBase64Image(main, 'main_image');
      }

      if (Array.isArray(additional) && additional.length > 0) {
        for (const img of additional) {
          if (typeof img === 'string') {
            const url = await uploadBase64Image(img, 'additional');
            additionalImageUrls.push(url);
          }
        }
      }

      // Remove images from the original body to keep DB clean
      delete req.body.images;
    }

    // Ensure the property is associated with the current user unless explicitly provided
    const insertPayload = {
      ...req.body,
      main_image: mainImageUrl,
      images: additionalImageUrls,
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
      plot_size: req.body.plot_size,
      land_type: req.body.land_type,
      zoning: req.body.zoning,
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
    ['floor', 'garden_area', 'bedrooms', 'bathrooms', 'livingrooms', 'parking_spaces', 'year_built', 'units', 'elevators', 'plot_size', 'shop_front_width', 'storage_area', 'ceiling_height', 'loading_docks', 'meeting_rooms'].forEach(field => {
      if (req.body[field] === null || req.body[field] === '' || req.body[field] === undefined) {
        updateData[field] = null;
      } else {
        // Use parseInt for integer fields and parseFloat for decimal fields
        if (['garden_area', 'plot_size', 'shop_front_width', 'storage_area', 'ceiling_height'].includes(field)) {
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
    ['water_source', 'crop_types', 'land_type', 'zoning'].forEach(field => {
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

    // Handle images (upload to storage / delete as needed)
    if (req.body.images) {
      const { main, additional } = req.body.images;

      // --- Main image processing ---
      if (Object.prototype.hasOwnProperty.call(req.body.images, 'main')) {
        if (main === null) {
          // Delete existing main image
          await removeImageFromStorage(existingProperty.main_image);
          updateData.main_image = null;
        } else if (typeof main === 'string' && main.startsWith('data:image')) {
          // Replace with new image
          const newMainUrl = await uploadBase64Image(main, `${existingProperty.id}-main_image`);
          // Remove old image
          await removeImageFromStorage(existingProperty.main_image);
          updateData.main_image = newMainUrl;
        }
      }

      // --- Additional images processing ---
      // 1. Deletions (removeAdditional)
      let galleryImages = existingProperty.images || [];
      if (Object.prototype.hasOwnProperty.call(req.body.images, 'removeAdditional') && Array.isArray(req.body.images.removeAdditional)) {
        const toRemove = req.body.images.removeAdditional;
        await removeImagesFromStorage(toRemove);
        galleryImages = galleryImages.filter(url => !toRemove.includes(url));
      }

      // 2. New uploads (additional)
      if (Object.prototype.hasOwnProperty.call(req.body.images, 'additional')) {
        if (Array.isArray(additional)) {
          if (additional.length === 0 && galleryImages.length === 0) {
            // Special case: clear all if nothing left
            galleryImages = [];
          } else {
            const newUploadedUrls = [];
            for (const img of additional) {
              if (typeof img === 'string' && img.startsWith('data:image')) {
                const url = await uploadBase64Image(img, `${existingProperty.id}-additional`);
                newUploadedUrls.push(url);
              }
            }
            galleryImages = galleryImages.concat(newUploadedUrls);
          }
        }
      }

      // Persist gallery changes if any
      if (Object.prototype.hasOwnProperty.call(req.body.images, 'removeAdditional') || (Array.isArray(additional) && additional.length)) {
        updateData.images = galleryImages;
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
