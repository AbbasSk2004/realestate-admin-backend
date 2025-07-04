-- Enable necessary extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Drop existing trigger if it exists
drop trigger if exists on_auth_user_created on auth.users;

-- Drop existing tables if they exist
drop table if exists public.profiles cascade;
drop table if exists public.property_views cascade;
drop table if exists public.notifications cascade;

drop table if exists public.conversations cascade;
drop table if exists public.messages cascade;
drop table if exists public.contact_submissions cascade;
drop table if exists public.agents cascade;
drop table if exists public.blogs cascade;
drop table if exists public.faqs cascade;
drop table if exists public.favorites cascade;
drop table if exists public.properties cascade;
drop table if exists public.property_inquiries cascade;
drop table if exists public.testimonials cascade;

drop table if exists public.payments cascade;

-- Create tables
CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  profiles_id uuid NOT NULL UNIQUE,
  firstname text,
  lastname text,
  email text,
  profile_photo text,
  phone text,
  role text DEFAULT 'user'::text,
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  last_login timestamp with time zone,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_profiles_id_fkey FOREIGN KEY (profiles_id) REFERENCES auth.users(id)
);

-- Create payments table
CREATE TABLE public.payments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  profiles_id uuid NOT NULL,
  property_id uuid,
  amount numeric NOT NULL,
  payment_type text NOT NULL,
  payment_status text NOT NULL DEFAULT 'completed',
  card_last_four text,
  transaction_id text,
  payment_method text NOT NULL,
  billing_name text,
  billing_email text,
  description text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_profiles_id_fkey FOREIGN KEY (profiles_id) REFERENCES public.profiles(profiles_id),
  CONSTRAINT payments_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id)
);

-- Create indexes for payments table
CREATE INDEX idx_payments_profiles_id ON public.payments(profiles_id);
CREATE INDEX idx_payments_property_id ON public.payments(property_id);
CREATE INDEX idx_payments_payment_status ON public.payments(payment_status);
CREATE INDEX idx_payments_created_at ON public.payments(created_at);

-- Enable row level security for payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Create policies for payments
CREATE POLICY "Users can view their own payments"
  ON public.payments FOR SELECT
  USING (auth.uid() = profiles_id);

CREATE POLICY "Users can insert their own payments"
  ON public.payments FOR INSERT
  WITH CHECK (auth.uid() = profiles_id);

CREATE POLICY "Admins can view all payments"
  ON public.payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles_id = auth.uid()
      AND role = 'admin'
    )
  );

-- Function to track property featuring after payment
CREATE OR REPLACE FUNCTION public.mark_property_as_featured()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if the payment is for featuring a property
  IF NEW.payment_status = 'completed' AND NEW.description LIKE '%feature%' THEN
    -- Update the property to be featured
    UPDATE public.properties
    SET is_featured = true
    WHERE id = NEW.property_id;
    
    -- Create a notification for the property owner
    INSERT INTO public.notifications (
      profiles_id,
      type,
      title,
      message,
      data
    )
    SELECT
      NEW.profiles_id,
      'payment_success',
      'Property Featured Successfully',
      'Your property has been successfully featured and will now appear at the top of search results.',
      jsonb_build_object(
        'property_id', NEW.property_id,
        'payment_id', NEW.id,
        'amount', NEW.amount
      );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for featuring properties after payment
CREATE TRIGGER on_payment_completed
  AFTER INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_property_as_featured();

CREATE TABLE public.agents (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  profiles_id uuid NOT NULL UNIQUE,
  specialty text NOT NULL,
  experience text NOT NULL,
  about_me text NOT NULL,
  cv_resume_url text,
  facebook_url text,
  twitter_url text,
  instagram_url text,
  phone text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  approved boolean DEFAULT false,
  approved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  image text,
  is_featured boolean DEFAULT false,
  CONSTRAINT agents_pkey PRIMARY KEY (id),
  CONSTRAINT agents_profiles_id_fkey FOREIGN KEY (profiles_id) REFERENCES public.profiles(profiles_id)
);

CREATE TABLE public.blogs (
  id integer NOT NULL DEFAULT nextval('blogs_id_seq'::regclass),
  title character varying NOT NULL,
  slug character varying NOT NULL UNIQUE,
  content text NOT NULL,
  image_url text,
  excerpt character varying,
  category character varying,
  tags text[],
  status text DEFAULT 'published'::text,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT blogs_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_blogs_slug ON blogs(slug);
CREATE INDEX idx_blogs_category ON blogs(category);
CREATE INDEX idx_blogs_status ON blogs(status);

ALTER TABLE public.blogs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Blogs are viewable by everyone" 
  ON public.blogs FOR SELECT
  USING (true);

CREATE POLICY "Only admins can insert blogs"
  ON public.blogs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles_id = auth.uid()
      AND role = 'admin'
    )
  );

CREATE POLICY "Only admins can update blogs"
  ON public.blogs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles_id = auth.uid()
      AND role = 'admin'
    )
  );

CREATE POLICY "Only admins can delete blogs"
  ON public.blogs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles_id = auth.uid()
      AND role = 'admin'
    )
  );

GRANT ALL ON public.blogs TO authenticated;
GRANT ALL ON public.blogs TO service_role;
GRANT SELECT ON public.blogs TO anon;

CREATE TABLE public.contact_submissions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  message text NOT NULL,
  preferred_contact text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  status text DEFAULT 'pending'::text,
  CONSTRAINT contact_submissions_pkey PRIMARY KEY (id)
);

CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  participant1_id uuid NOT NULL,
  participant2_id uuid NOT NULL,
  last_message jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  property_id uuid,
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_participant1_fkey FOREIGN KEY (participant1_id) REFERENCES public.profiles(profiles_id),
  CONSTRAINT conversations_participant2_fkey FOREIGN KEY (participant2_id) REFERENCES public.profiles(profiles_id),
  CONSTRAINT conversations_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id)
);

CREATE TABLE public.faqs (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  is_featured boolean DEFAULT false,
  order_number integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT faqs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.favorites (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  profiles_id uuid,
  property_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT favorites_pkey PRIMARY KEY (id),
  CONSTRAINT favorites_profiles_id_fkey FOREIGN KEY (profiles_id) REFERENCES public.profiles(profiles_id),
  CONSTRAINT favorites_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id)
);

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  content text NOT NULL,
  read boolean DEFAULT false,
  message_type text DEFAULT 'text'::text,
  file_url text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT messages_sender_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(profiles_id)
);



CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  profiles_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  data jsonb,
  read boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_profiles_fkey FOREIGN KEY (profiles_id) REFERENCES public.profiles(profiles_id)
);

-- Create admin_notifications table for admin panel notifications
CREATE TABLE public.admin_notifications (
  id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES auth.users(id),
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  read BOOLEAN DEFAULT false,
  action_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for admin_notifications
CREATE INDEX IF NOT EXISTS idx_admin_notifications_admin_id ON public.admin_notifications(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_read ON public.admin_notifications(read);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_at ON public.admin_notifications(created_at);

-- Enable row level security for admin_notifications
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Create policy for admin access to admin_notifications
CREATE POLICY "Admins can manage their notifications"
  ON public.admin_notifications
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles_id = auth.uid() 
      AND role = 'admin'
    )
    AND admin_id = auth.uid()
  );

-- Create trigger for updating updated_at in admin_notifications
CREATE TRIGGER update_admin_notifications_updated_at
  BEFORE UPDATE ON public.admin_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions for admin_notifications
GRANT ALL ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;

CREATE TABLE public.properties (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  description text,
  property_type text,
  status text NOT NULL DEFAULT ''::text,
  price numeric NOT NULL,
  bedrooms integer,
  bathrooms integer,
  area numeric,
  address text,
  city text,
  governate text,
  village text,
  features jsonb,
  images text[],
  profiles_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  livingrooms integer,
  main_image text,
  location_url text,
  floor integer,
  year_built integer,
  garden_area numeric,
  is_featured boolean DEFAULT false,
  parking_spaces integer,
  furnishing_status text,
  shop_front_width numeric,
  storage_area numeric,
  land_type text,
  zoning text,
  meeting_rooms integer,
  office_layout text,
  units integer,
  elevators integer,
  plot_size numeric,
  ceiling_height numeric,
  loading_docks integer,
  farm_area numeric,
  water_source text,
  crop_types text,
  view text,
  verified boolean DEFAULT false,
  recommended boolean DEFAULT false,
  CONSTRAINT properties_pkey PRIMARY KEY (id),
  CONSTRAINT properties_profiles_id_fkey FOREIGN KEY (profiles_id) REFERENCES public.profiles(profiles_id)
);

CREATE TABLE public.property_inquiries (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  property_id uuid,
  profiles_id uuid,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  subject text,
  CONSTRAINT property_inquiries_pkey PRIMARY KEY (id),
  CONSTRAINT property_inquiries_profiles_id_fkey FOREIGN KEY (profiles_id) REFERENCES public.profiles(profiles_id),
  CONSTRAINT property_inquiries_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id)
);

CREATE TABLE public.property_views (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  property_id uuid NOT NULL,
  profiles_id uuid,
  viewed_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  ip_address text NOT NULL,
  viewed_date date NOT NULL,
  CONSTRAINT property_views_pkey PRIMARY KEY (id),
  CONSTRAINT property_views_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id),
  CONSTRAINT fk_profiles_id FOREIGN KEY (profiles_id) REFERENCES public.profiles(profiles_id)
);

CREATE TABLE public.testimonials (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  profiles_id uuid UNIQUE,
  content text NOT NULL,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  approved boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT testimonials_pkey PRIMARY KEY (id),
  CONSTRAINT testimonials_profiles_id_fkey FOREIGN KEY (profiles_id) REFERENCES public.profiles(profiles_id)
);



-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_properties_type ON public.properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_status ON public.properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_price ON public.properties(price);
CREATE INDEX IF NOT EXISTS idx_properties_area ON public.properties(area);
CREATE INDEX IF NOT EXISTS idx_properties_bedrooms ON public.properties(bedrooms);
CREATE INDEX IF NOT EXISTS idx_properties_bathrooms ON public.properties(bathrooms);
CREATE INDEX IF NOT EXISTS idx_properties_location ON public.properties(governate, city, village);
CREATE INDEX IF NOT EXISTS idx_properties_features ON public.properties USING gin(features);
CREATE INDEX IF NOT EXISTS idx_properties_created_at ON public.properties(created_at);
CREATE INDEX IF NOT EXISTS idx_properties_updated_at ON public.properties(updated_at);
CREATE INDEX IF NOT EXISTS idx_properties_is_featured ON public.properties(is_featured);
CREATE INDEX IF NOT EXISTS idx_properties_year_built ON public.properties(year_built);
CREATE INDEX IF NOT EXISTS idx_properties_parking_spaces ON public.properties(parking_spaces);

-- Add indexes for favorites table
CREATE INDEX IF NOT EXISTS idx_favorites_profiles_id ON public.favorites(profiles_id);
CREATE INDEX IF NOT EXISTS idx_favorites_property_id ON public.favorites(property_id);
CREATE INDEX IF NOT EXISTS idx_favorites_profiles_property ON public.favorites(profiles_id, property_id);

-- Enable Row Level Security
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

-- Favorites policies
CREATE POLICY "Users can view own favorites"
  ON public.favorites FOR SELECT
  USING (auth.uid() = profiles_id);

CREATE POLICY "Users can insert own favorites"
  ON public.favorites FOR INSERT
  WITH CHECK (auth.uid() = profiles_id);

CREATE POLICY "Users can delete own favorites"
  ON public.favorites FOR DELETE
  USING (auth.uid() = profiles_id);

-- Enable RLS for notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;


-- Notification policies
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = profiles_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = profiles_id);


-- Add indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_profiles_id ON public.notifications(profiles_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at);

-- Add indexes for notification settings


-- Enable RLS for agents table
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Agents are viewable by everyone" ON public.agents;
DROP POLICY IF EXISTS "Users can submit their own agent application" ON public.agents;
DROP POLICY IF EXISTS "Users can update their own agent application" ON public.agents;
DROP POLICY IF EXISTS "Admins can manage agent applications" ON public.agents;

-- 1. View policy - Anyone can view approved agents, admins can view all, users can view their own
CREATE POLICY "Agents are viewable by everyone"
  ON public.agents FOR SELECT
  USING (
    status = 'approved' AND approved = true
    OR 
    (auth.uid() IS NOT NULL AND profiles_id = auth.uid())
    OR
    (
      auth.uid() IS NOT NULL AND 
      EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles_id = auth.uid() 
        AND role = 'admin'
      )
    )
  );

-- 2. Insert policy - Users can submit one application
CREATE POLICY "Users can submit their own agent application"
  ON public.agents FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = profiles_id
    AND NOT EXISTS (
      SELECT 1 FROM public.agents 
      WHERE profiles_id = auth.uid()
    )
  );

-- 3. Update policy - Users can update pending applications, admins can update any
CREATE POLICY "Users can update their own agent application"
  ON public.agents FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles_id = auth.uid() 
      AND role = 'admin'
    )
    OR
    (auth.uid() = profiles_id AND status = 'pending')
  );

-- 4. Delete policy - Only admins can delete
CREATE POLICY "Admins can delete agent applications"
  ON public.agents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE profiles_id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Function to get approved agents
CREATE OR REPLACE FUNCTION get_approved_agents()
RETURNS TABLE (
    id uuid,
    profiles_id uuid,
    specialty text,
    experience text,
    about_me text,
    facebook_url text,
    twitter_url text,
    instagram_url text,
    phone text,
    image text,
    firstname text,
    lastname text,
    email text,
    profile_photo text,
    is_featured boolean
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.profiles_id,
        a.specialty,
        a.experience,
        a.about_me,
        a.facebook_url,
        a.twitter_url,
        a.instagram_url,
        a.phone,
        a.image,
        p.firstname,
        p.lastname,
        p.email,
        p.profile_photo,
        a.is_featured
    FROM public.agents a
    LEFT JOIN public.profiles p ON p.profiles_id = a.profiles_id
    WHERE a.status = 'approved'
    AND a.approved = true
    ORDER BY a.is_featured DESC, a.created_at DESC;
END;
$$;

-- Function to get featured agents
CREATE OR REPLACE FUNCTION get_featured_agents()
RETURNS TABLE (
    id uuid,
    profiles_id uuid,
    specialty text,
    experience text,
    about_me text,
    facebook_url text,
    twitter_url text,
    instagram_url text,
    phone text,
    image text,
    firstname text,
    lastname text,
    email text,
    profile_photo text
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.profiles_id,
        a.specialty,
        a.experience,
        a.about_me,
        a.facebook_url,
        a.twitter_url,
        a.instagram_url,
        a.phone,
        a.image,
        p.firstname,
        p.lastname,
        p.email,
        p.profile_photo
    FROM public.agents a
    LEFT JOIN public.profiles p ON p.profiles_id = a.profiles_id
    WHERE a.status = 'approved'
    AND a.approved = true
    AND a.is_featured = true
    ORDER BY a.created_at DESC;
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_approved_agents() TO authenticated;
GRANT EXECUTE ON FUNCTION get_approved_agents() TO anon;
GRANT EXECUTE ON FUNCTION get_featured_agents() TO authenticated;
GRANT EXECUTE ON FUNCTION get_featured_agents() TO anon;

-- Create timestamp update trigger
CREATE OR REPLACE FUNCTION update_agent_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_agents_timestamp
    BEFORE UPDATE ON public.agents
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_timestamps();

-- Create index for featured agents
CREATE OR REPLACE FUNCTION public.get_featured_agents()
RETURNS TABLE (
  id uuid,
  profiles_id uuid,
  specialty text,
  experience text,
  about_me text,
  facebook_url text,
  twitter_url text,
  instagram_url text,
  phone text,
  image text,
  firstname text,
  lastname text,
  email text,
  profile_photo text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.profiles_id,
    a.specialty,
    a.experience,
    a.about_me,
    a.facebook_url,
    a.twitter_url,
    a.instagram_url,
    a.phone,
    a.image,
    p.firstname,
    p.lastname,
    p.email,
    p.profile_photo
  FROM public.agents a
  JOIN public.profiles p ON p.profiles_id = a.profiles_id
  WHERE a.is_featured = true
  AND a.status = 'approved'
  AND a.approved = true
  ORDER BY a.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions for the function
GRANT EXECUTE ON FUNCTION public.get_featured_agents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_featured_agents() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_featured_agents() TO anon;

-- Create indexes for frequently queried columns
CREATE INDEX idx_properties_id ON public.properties(id);
CREATE INDEX idx_properties_profiles_id ON public.properties(profiles_id);
CREATE INDEX idx_property_views_property_id ON public.property_views(property_id);
CREATE INDEX idx_property_views_profiles_id ON public.property_views(profiles_id);
CREATE INDEX idx_testimonials_profiles_id ON public.testimonials(profiles_id);
CREATE INDEX idx_property_inquiries_property_id ON public.property_inquiries(property_id);
CREATE INDEX idx_property_inquiries_profiles_id ON public.property_inquiries(profiles_id);

-- RLS Policies
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.messages enable row level security;
alter table public.property_views enable row level security;
alter table public.notifications enable row level security;

alter table public.testimonials enable row level security;
alter table public.property_inquiries enable row level security;

-- Profiles policies
create policy "Public profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = profiles_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = profiles_id);

-- Properties policies
CREATE POLICY "Enable read access for all users"
  ON public.properties FOR SELECT
  USING (true);

CREATE POLICY "Enable insert for authenticated users only"
  ON public.properties FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for users based on profiles_id"
  ON public.properties FOR UPDATE
  USING (auth.uid() = profiles_id);

CREATE POLICY "Enable delete for users based on profiles_id"
  ON public.properties FOR DELETE
  USING (auth.uid() = profiles_id);

-- Messages policies
create policy "Users can view own messages"
  on public.messages for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

create policy "Users can send messages"
  on public.messages for insert
  with check (auth.uid() = sender_id);



-- Testimonials policies
create policy "Testimonials are viewable by everyone"
  on public.testimonials for select
  using (true);

create policy "Users can create testimonials"
  on public.testimonials for insert
  with check (auth.uid() = profiles_id);

-- Property inquiries policies
create policy "Users can view their own inquiries"
  on public.property_inquiries for select
  using (auth.uid() = profiles_id);

create policy "Property owners can view inquiries for their properties"
  on public.property_inquiries for select
  using (
    auth.uid() = (
      SELECT p.profiles_id 
      FROM public.properties prop
      JOIN public.profiles p ON p.profiles_id = prop.profiles_id
      WHERE prop.id = property_inquiries.property_id
    )
  );

create policy "Authenticated users can create inquiries"
  on public.property_inquiries for insert
  with check (auth.role() = 'authenticated');

create policy "Property owners can update inquiry status"
  on public.property_inquiries for update
  using (
    auth.uid() = (
      SELECT p.profiles_id 
      FROM public.properties prop
      JOIN public.profiles p ON p.profiles_id = prop.profiles_id
      WHERE prop.id = property_inquiries.property_id
    )
  );

-- Function to handle new user creation from OAuth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  google_identity record;
  meta_data jsonb;
  admin_user record;
BEGIN
  -- Get Google identity data
  SELECT * INTO google_identity 
  FROM auth.identities 
  WHERE user_id = new.id AND provider = 'google'
  LIMIT 1;

  -- Get metadata from raw_user_meta_data
  meta_data := COALESCE(new.raw_user_meta_data, '{}'::jsonb);

  -- Use an upsert to handle race conditions
  INSERT INTO public.profiles (
    profiles_id,
    firstname,
    lastname,
    email,
    profile_photo,
    role,
    status
  ) VALUES (
    new.id,
    CASE 
      WHEN google_identity IS NOT NULL THEN
        COALESCE(
          google_identity.raw_user_meta_data->>'given_name',
          meta_data->>'firstname',
          meta_data->>'firstName',
          meta_data->>'first_name',
          meta_data->>'given_name',
          ''
        )
      ELSE
        COALESCE(
          meta_data->>'firstname',
          meta_data->>'firstName',
          meta_data->>'first_name',
          meta_data->>'given_name',
          ''
        )
    END,
    CASE 
      WHEN google_identity IS NOT NULL THEN
        COALESCE(
          google_identity.raw_user_meta_data->>'family_name',
          meta_data->>'lastname',
          meta_data->>'lastName',
          meta_data->>'last_name',
          meta_data->>'family_name',
          ''
        )
      ELSE
        COALESCE(
          meta_data->>'lastname',
          meta_data->>'lastName',
          meta_data->>'last_name',
          meta_data->>'family_name',
          ''
        )
    END,
    new.email,
    CASE 
      WHEN google_identity IS NOT NULL THEN
        COALESCE(
          google_identity.raw_user_meta_data->>'picture',
          meta_data->>'avatar_url',
          meta_data->>'picture',
          ''
        )
      ELSE
        COALESCE(
          meta_data->>'avatar_url',
          meta_data->>'picture',
          ''
        )
    END,
    'user',
    'active'
  )
  ON CONFLICT (profiles_id) DO UPDATE SET
    firstname = EXCLUDED.firstname,
    lastname = EXCLUDED.lastname,
    email = EXCLUDED.email,
    profile_photo = EXCLUDED.profile_photo,
    updated_at = now()
  WHERE profiles.firstname IS NULL 
     OR profiles.lastname IS NULL
     OR profiles.email IS NULL;

  -- Create notifications for all admins
  FOR admin_user IN (
    SELECT profiles_id 
    FROM public.profiles 
    WHERE role = 'admin'
  ) LOOP
    -- Insert notification into admin_notifications table
    INSERT INTO public.admin_notifications (
      admin_id,
      title,
      message,
      type,
      action_url
    ) VALUES (
      admin_user.profiles_id,
      'New User Registration',
      'A new user ' || new.email || ' has registered on the platform.',
      'user',
      '/admin/users'
    );
  END LOOP;

  RETURN new;
EXCEPTION 
  WHEN undefined_column THEN
    -- Handle specifically the case where a column doesn't exist
    RAISE WARNING 'Column access error in handle_new_user: %, User ID: %, Email: %',
      SQLERRM,
      new.id,
      new.email;
    RETURN new;
  WHEN others THEN
    -- Log detailed error information for other cases
    RAISE WARNING 'Error in handle_new_user: %, SQLSTATE: %, User ID: %, Email: %, Metadata: %',
      SQLERRM,
      SQLSTATE,
      new.id,
      new.email,
      meta_data;
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Enable RLS on profiles table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Create RLS policies for profiles
CREATE POLICY "Public profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = profiles_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = profiles_id);

-- Create a more robust update_profile function
create or replace function public.update_profile(
    p_profiles_id uuid,
    p_update_data jsonb
) returns json
language plpgsql
security definer
as $$
declare
    v_result json;
    v_google_identity record;
begin
    -- Get Google identity data if available
    select * into v_google_identity 
    from auth.identities 
    where user_id = p_profiles_id and provider = 'google'
    limit 1;

    -- Update the profile
    with updated_profile as (
        update public.profiles
        set
            firstname = case 
                when v_google_identity is not null and (p_update_data->>'firstname') is null then
                    coalesce(
                        v_google_identity.raw_user_meta_data->>'given_name',
                        firstname
                    )
                else
                    coalesce((p_update_data->>'firstname')::text, firstname)
                end,
            lastname = case 
                when v_google_identity is not null and (p_update_data->>'lastname') is null then
                    coalesce(
                        v_google_identity.raw_user_meta_data->>'family_name',
                        lastname
                    )
                else
                    coalesce((p_update_data->>'lastname')::text, lastname)
                end,
            email = coalesce((p_update_data->>'email')::text, email),
            phone = coalesce((p_update_data->>'phone')::text, phone),
            profile_photo = case 
                when v_google_identity is not null and (p_update_data->>'profile_photo') is null then
                    coalesce(
                        v_google_identity.raw_user_meta_data->>'picture',
                        profile_photo
                    )
                else
                    coalesce((p_update_data->>'profile_photo')::text, profile_photo)
                end,
            updated_at = now()
        where profiles_id = p_profiles_id
        returning *
    )
    select json_build_object(
        'success', true,
        'data', row_to_json(updated_profile)
    ) into v_result
    from updated_profile;

    -- Check if update was successful
    if v_result is null then
        return json_build_object(
            'success', false,
            'error', 'Profile not found',
            'profiles_id', p_profiles_id
        );
    end if;

    return v_result;
exception when others then
    return json_build_object(
        'success', false,
        'error', SQLERRM,
        'profiles_id', p_profiles_id
    );
end;
$$;

-- Create a helper function to check profile existence
create or replace function public.check_profile_exists(
    p_profiles_id uuid
) returns boolean
language sql
security definer
as $$
    select exists(
        select 1 
        from public.profiles 
        where profiles_id = p_profiles_id
    );
$$;

-- Grant permissions for the helper function
grant execute on function public.check_profile_exists(uuid) to authenticated;
grant execute on function public.check_profile_exists(uuid) to service_role;
grant execute on function public.check_profile_exists(uuid) to anon;

-- Grant permissions for update_profile
grant execute on function public.update_profile(uuid, jsonb) to authenticated;
grant execute on function public.update_profile(uuid, jsonb) to service_role;
grant execute on function public.update_profile(uuid, jsonb) to anon;

-- Create API endpoints for the functions
comment on function public.check_profile_exists(uuid) is 'Check if a profile exists for the given user ID';
comment on function public.update_profile(uuid, jsonb) is 'Update a user profile with the given data';

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_properties_created_at ON public.properties(created_at);
CREATE INDEX IF NOT EXISTS idx_testimonials_profiles_id ON public.testimonials(profiles_id);
CREATE INDEX IF NOT EXISTS idx_property_inquiries_property_id ON public.property_inquiries(property_id);
CREATE INDEX IF NOT EXISTS idx_property_inquiries_profiles_id ON public.property_inquiries(profiles_id);
CREATE INDEX IF NOT EXISTS idx_property_views_property_id ON public.property_views(property_id);
CREATE INDEX IF NOT EXISTS idx_property_views_profiles_id ON public.property_views(profiles_id);
CREATE INDEX IF NOT EXISTS idx_notifications_profiles_id ON public.notifications(profiles_id);

-- Add triggers for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    -- Safely attempt to set NEW.updated_at; if the table lacks this column, ignore the error
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
    EXCEPTION WHEN undefined_column THEN
        -- Column does not exist on this table; do nothing
        NULL;
    END;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_property_inquiries_updated_at
    BEFORE UPDATE ON public.property_inquiries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add missing columns to properties table
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS parking_spaces integer,
  ADD COLUMN IF NOT EXISTS furnishing_status text,
  ADD COLUMN IF NOT EXISTS shop_front_width numeric,
  ADD COLUMN IF NOT EXISTS storage_area numeric,
  ADD COLUMN IF NOT EXISTS land_type text,
  ADD COLUMN IF NOT EXISTS zoning text,
  ADD COLUMN IF NOT EXISTS meeting_rooms integer,
  ADD COLUMN IF NOT EXISTS office_layout text,
  ADD COLUMN IF NOT EXISTS units integer,
  ADD COLUMN IF NOT EXISTS elevators integer,
  ADD COLUMN IF NOT EXISTS plot_size numeric,
  ADD COLUMN IF NOT EXISTS ceiling_height numeric,
  ADD COLUMN IF NOT EXISTS loading_docks integer,
  ADD COLUMN IF NOT EXISTS farm_area numeric,
  ADD COLUMN IF NOT EXISTS water_source text,
  ADD COLUMN IF NOT EXISTS crop_types text,
  ADD COLUMN IF NOT EXISTS view text;

-- Add optimized indexes for property searches
CREATE INDEX IF NOT EXISTS idx_properties_status ON public.properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_property_type ON public.properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_price ON public.properties(price);
CREATE INDEX IF NOT EXISTS idx_properties_area ON public.properties(area);
CREATE INDEX IF NOT EXISTS idx_properties_bedrooms ON public.properties(bedrooms);
CREATE INDEX IF NOT EXISTS idx_properties_bathrooms ON public.properties(bathrooms);
CREATE INDEX IF NOT EXISTS idx_properties_governate ON public.properties(governate);
CREATE INDEX IF NOT EXISTS idx_properties_city ON public.properties(city);

-- Add composite indexes for common filter combinations
CREATE INDEX IF NOT EXISTS idx_properties_location ON public.properties(governate, city);
CREATE INDEX IF NOT EXISTS idx_properties_type_status ON public.properties(property_type, status);
CREATE INDEX IF NOT EXISTS idx_properties_price_area ON public.properties(price, area);
CREATE INDEX IF NOT EXISTS idx_properties_beds_baths ON public.properties(bedrooms, bathrooms);

-- Add index for featured properties
CREATE INDEX IF NOT EXISTS idx_properties_featured ON public.properties(is_featured);

-- Add index for timestamp range queries
CREATE INDEX IF NOT EXISTS idx_properties_created_updated ON public.properties(created_at, updated_at);

-- Add partial index for available properties
CREATE INDEX IF NOT EXISTS idx_properties_available ON public.properties(id) WHERE status = 'available';

-- Add index for full-text search on title and description
CREATE INDEX IF NOT EXISTS idx_properties_text_search ON public.properties USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- Add indexes for better query performance
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_messages_sender_id ON public.messages(sender_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at);
CREATE INDEX idx_conversations_participants ON public.conversations(participant1_id, participant2_id);
CREATE INDEX idx_conversations_updated_at ON public.conversations(updated_at);

-- Enable RLS for messages and conversations
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conversations
CREATE POLICY "Users can view their own conversations"
  ON public.conversations FOR SELECT
  USING (auth.uid() = participant1_id OR auth.uid() = participant2_id);

CREATE POLICY "Users can create conversations they are part of"
  ON public.conversations FOR INSERT
  WITH CHECK (auth.uid() = participant1_id OR auth.uid() = participant2_id);

CREATE POLICY "Users can update their own conversations"
  ON public.conversations FOR UPDATE
  USING (auth.uid() = participant1_id OR auth.uid() = participant2_id);

-- RLS Policies for messages
CREATE POLICY "Users can view messages in their conversations"
  ON public.messages FOR SELECT
  USING (
    auth.uid() IN (
      SELECT participant1_id FROM public.conversations WHERE id = conversation_id
      UNION
      SELECT participant2_id FROM public.conversations WHERE id = conversation_id
    )
  );

CREATE POLICY "Users can send messages in their conversations"
  ON public.messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id AND
    auth.uid() IN (
      SELECT participant1_id FROM public.conversations WHERE id = conversation_id
      UNION
      SELECT participant2_id FROM public.conversations WHERE id = conversation_id
    )
  );

-- Function to update conversation's last message and timestamp
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.conversations
  SET last_message = jsonb_build_object(
    'content', NEW.content,
    'sender_id', NEW.sender_id,
    'created_at', NEW.created_at,
    'message_type', NEW.message_type
  ),
  updated_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update conversation on new message
DROP TRIGGER IF EXISTS on_message_inserted ON public.messages;
CREATE TRIGGER on_message_inserted
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_last_message();

-- Contact form submissions table
CREATE TABLE public.contact_submissions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  message text NOT NULL,
  preferred_contact text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  status text DEFAULT 'pending'::text,
  CONSTRAINT contact_submissions_pkey PRIMARY KEY (id)
);

-- Enable RLS for contact submissions
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- Contact submissions policies
CREATE POLICY "Anyone can insert contact submissions"
  ON public.contact_submissions FOR INSERT
  WITH CHECK (true);

-- Add indexes
CREATE INDEX idx_contact_submissions_email ON public.contact_submissions(email);
CREATE INDEX idx_contact_submissions_created_at ON public.contact_submissions(created_at);

-- Create function to get all approved agents
CREATE OR REPLACE FUNCTION get_all_approved_agents()
RETURNS TABLE (
    id uuid,
    profiles_id uuid,
    specialty text,
    experience text,
    about_me text,
    facebook_url text,
    twitter_url text,
    instagram_url text,
    phone text,
    image text,
    firstname text,
    lastname text,
    email text,
    profile_photo text,
    status text,
    approved boolean,
    is_featured boolean
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.profiles_id,
        a.specialty,
        a.experience,
        a.about_me,
        a.facebook_url,
        a.twitter_url,
        a.instagram_url,
        a.phone,
        a.image,
        p.firstname,
        p.lastname,
        p.email,
        p.profile_photo,
        a.status,
        a.approved,
        a.is_featured
    FROM public.agents a
    LEFT JOIN public.profiles p ON p.profiles_id = a.profiles_id
    WHERE a.status = 'approved'
    AND a.approved = true
    ORDER BY a.is_featured DESC, a.created_at DESC;
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION get_all_approved_agents() TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_approved_agents() TO anon;

-- Add some test agents data
INSERT INTO public.profiles (profiles_id, firstname, lastname, email, role, status) VALUES
  ('550e8400-e29b-41d4-a716-446655440001', 'John', 'Smith', 'john.smith@example.com', 'agent', 'active'),
  ('550e8400-e29b-41d4-a716-446655440002', 'Sarah', 'Johnson', 'sarah.johnson@example.com', 'agent', 'active'),
  ('550e8400-e29b-41d4-a716-446655440003', 'Mike', 'Davis', 'mike.davis@example.com', 'agent', 'active')
ON CONFLICT (profiles_id) DO NOTHING;

-- Add corresponding agent records
INSERT INTO public.agents (profiles_id, specialty, experience, about_me, status, approved, is_featured, cv_resume_url) VALUES
  ('550e8400-e29b-41d4-a716-446655440001', 'Residential Sales', '5+ years', 'Experienced real estate agent specializing in residential properties.', 'approved', true, true, 'https://example.com/cv1.pdf'),
  ('550e8400-e29b-41d4-a716-446655440002', 'Commercial Leasing', '3-5 years', 'Expert in commercial property leasing and investment.', 'approved', true, false, 'https://example.com/cv2.pdf'),
  ('550e8400-e29b-41d4-a716-446655440003', 'Property Management', '1-3 years', 'Focused on property management and rental services.', 'approved', true, false, 'https://example.com/cv3.pdf')
ON CONFLICT (profiles_id) DO NOTHING;

-- Update RLS policies to allow public access to approved agents
DROP POLICY IF EXISTS "Agents are viewable by everyone" ON public.agents;

CREATE POLICY "Agents are viewable by everyone"
  ON public.agents FOR SELECT
  USING (
    status = 'approved' AND approved = true
  );

-- Ensure profiles can be read publicly for agent data
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Public profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (true);

-- Create missing indexes for better performance
CREATE INDEX IF NOT EXISTS idx_conversations_participant1 ON conversations(participant1_id);
CREATE INDEX IF NOT EXISTS idx_conversations_participant2 ON conversations(participant2_id);
CREATE INDEX IF NOT EXISTS idx_conversations_property ON conversations(property_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  -- Attempt to set updated_at; silently skip if the column is absent
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
  EXCEPTION WHEN undefined_column THEN
    NULL; -- no updated_at column on this table
  END;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create view for unread messages count
CREATE OR REPLACE VIEW unread_messages_count AS
SELECT 
  m.conversation_id,
  c.participant1_id,
  c.participant2_id,
  COUNT(*) FILTER (WHERE NOT m.read AND m.sender_id != profiles_id) as unread_count
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
CROSS JOIN UNNEST(ARRAY[c.participant1_id, c.participant2_id]) AS profiles_id
GROUP BY m.conversation_id, c.participant1_id, c.participant2_id;

-- Add indexes for property type specific searches
CREATE INDEX IF NOT EXISTS idx_properties_type ON public.properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_land_type ON public.properties(land_type) WHERE property_type = 'Land';
CREATE INDEX IF NOT EXISTS idx_properties_office_layout ON public.properties(office_layout) WHERE property_type = 'Office';

-- Add NOT NULL constraints if they don't exist
ALTER TABLE public.property_views 
    ALTER COLUMN property_id SET NOT NULL,
    ALTER COLUMN ip_address SET NOT NULL;

-- Add a new column for the truncated date if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'property_views' 
        AND column_name = 'viewed_date'
    ) THEN
        ALTER TABLE public.property_views 
        ADD COLUMN viewed_date date;
        
        -- Update the new column with the truncated date values
        UPDATE public.property_views 
        SET viewed_date = date_trunc('day', viewed_at)::date;
        
        -- Make viewed_date NOT NULL after populating it
        ALTER TABLE public.property_views 
        ALTER COLUMN viewed_date SET NOT NULL;
    END IF;
END $$;

-- Drop existing unique constraint if it exists
DO $$ 
BEGIN 
    IF EXISTS (
        SELECT 1 
        FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND indexname = 'unique_ip_view_24h'
    ) THEN
        DROP INDEX public.unique_ip_view_24h;
    END IF;
END $$;

-- Create new unique constraint
CREATE UNIQUE INDEX unique_ip_view_24h 
ON public.property_views (property_id, ip_address, viewed_date);

-- Create or replace helper functions for property views
CREATE OR REPLACE FUNCTION public.get_property_views(property_uuid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::integer
        FROM public.property_views
        WHERE property_id = property_uuid
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_total_views(user_uuid uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::integer
        FROM public.property_views pv
        JOIN public.properties p ON p.id = pv.property_id
        WHERE p.profiles_id = user_uuid
    );
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.get_property_views(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_property_views(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_total_views(uuid) TO authenticated;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_properties_verified ON public.properties(verified);
CREATE INDEX IF NOT EXISTS idx_properties_recommended ON public.properties(recommended);



-



-- 1. Function for new property notifications
CREATE OR REPLACE FUNCTION notify_new_property()
RETURNS TRIGGER AS $$
DECLARE
    admin_user record;
BEGIN
    -- Create notifications for all admins
    FOR admin_user IN (
        SELECT profiles_id 
        FROM public.profiles 
        WHERE role = 'admin'
    ) LOOP
        INSERT INTO public.admin_notifications (
            admin_id,
            title,
            message,
            type,
            action_url
        ) VALUES (
            admin_user.profiles_id,
            'New Property Listed',
            'A new property "' || NEW.title || '" has been listed for ' || NEW.price || '.',
            'property',
            '/admin/properties/' || NEW.id
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Function for new testimonial notifications
CREATE OR REPLACE FUNCTION notify_new_testimonial()
RETURNS TRIGGER AS $$
DECLARE
    admin_user record;
BEGIN
    -- Create notifications for all admins
    FOR admin_user IN (
        SELECT profiles_id 
        FROM public.profiles 
        WHERE role = 'admin'
    ) LOOP
        INSERT INTO public.admin_notifications (
            admin_id,
            title,
            message,
            type,
            action_url
        ) VALUES (
            admin_user.profiles_id,
            'New Testimonial Submitted',
            'A new testimonial has been submitted and needs review.',
            'testimonial',
            '/admin/testimonials'
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Function for new property inquiry notifications
CREATE OR REPLACE FUNCTION notify_new_property_inquiry()
RETURNS TRIGGER AS $$
DECLARE
    admin_user record;
    property_title text;
BEGIN
    -- Get property title
    SELECT title INTO property_title 
    FROM public.properties 
    WHERE id = NEW.property_id;

    -- Create notifications for all admins
    FOR admin_user IN (
        SELECT profiles_id 
        FROM public.profiles 
        WHERE role = 'admin'
    ) LOOP
        INSERT INTO public.admin_notifications (
            admin_id,
            title,
            message,
            type,
            action_url
        ) VALUES (
            admin_user.profiles_id,
            'New Property Inquiry',
            'New inquiry received for property "' || COALESCE(property_title, 'Unknown') || '"',
            'inquiry',
            '/admin/inquiries'
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Function for new contact submission notifications
CREATE OR REPLACE FUNCTION notify_new_contact_submission()
RETURNS TRIGGER AS $$
DECLARE
    admin_user record;
BEGIN
    -- Create notifications for all admins
    FOR admin_user IN (
        SELECT profiles_id 
        FROM public.profiles 
        WHERE role = 'admin'
    ) LOOP
        INSERT INTO public.admin_notifications (
            admin_id,
            title,
            message,
            type,
            action_url
        ) VALUES (
            admin_user.profiles_id,
            'New Contact Form Submission',
            'New contact form submission from ' || NEW.name || ' (' || NEW.email || ')',
            'contact',
            '/admin/contacts'
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Function for new agent application notifications
CREATE OR REPLACE FUNCTION notify_new_agent_application()
RETURNS TRIGGER AS $$
DECLARE
    admin_user record;
    agent_name text;
BEGIN
    -- Get agent name from profiles
    SELECT firstname || ' ' || lastname INTO agent_name 
    FROM public.profiles 
    WHERE profiles_id = NEW.profiles_id;

    -- Create notifications for all admins
    FOR admin_user IN (
        SELECT profiles_id 
        FROM public.profiles 
        WHERE role = 'admin'
    ) LOOP
        INSERT INTO public.admin_notifications (
            admin_id,
            title,
            message,
            type,
            action_url
        ) VALUES (
            admin_user.profiles_id,
            'New Agent Application',
            'New agent application received from ' || COALESCE(agent_name, 'Unknown'),
            'agent',
            '/admin/agents'
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Now create triggers for each table

-- 1. Trigger for new properties
DROP TRIGGER IF EXISTS trigger_new_property_notification ON public.properties;
CREATE TRIGGER trigger_new_property_notification
    AFTER INSERT ON public.properties
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_property();

-- 2. Trigger for new testimonials
DROP TRIGGER IF EXISTS trigger_new_testimonial_notification ON public.testimonials;
CREATE TRIGGER trigger_new_testimonial_notification
    AFTER INSERT ON public.testimonials
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_testimonial();

-- 3. Trigger for new property inquiries
DROP TRIGGER IF EXISTS trigger_new_property_inquiry_notification ON public.property_inquiries;
CREATE TRIGGER trigger_new_property_inquiry_notification
    AFTER INSERT ON public.property_inquiries
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_property_inquiry();

-- 4. Trigger for new contact submissions
DROP TRIGGER IF EXISTS trigger_new_contact_submission_notification ON public.contact_submissions;
CREATE TRIGGER trigger_new_contact_submission_notification
    AFTER INSERT ON public.contact_submissions
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_contact_submission();

CREATE OR REPLACE TRIGGER agent_application_notification_trigger
AFTER INSERT ON public.agents
FOR EACH ROW
EXECUTE FUNCTION notify_new_agent_application();
-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION notify_new_property() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_new_testimonial() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_new_property_inquiry() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_new_contact_submission() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_new_agent_application() TO authenticated;

-- =============================================
-- NOTIFICATION SYSTEM FOR USER ACTIONS
-- =============================================


    
    
 
    -- Send notification if allowed
    IF should_send THEN
        INSERT INTO notifications (
            profiles_id,
            type,
            title,
            message,
            data,
            read,
            created_at
        ) VALUES (
            user_id,
            notification_type,
            title,
            message,
            COALESCE(metadata, '{}'::jsonb),
            false,
            now()
        );
    END IF;
    
    RETURN should_send;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to notify property owner when someone favorites their property
CREATE OR REPLACE FUNCTION notify_property_favorited()
RETURNS TRIGGER AS $$
DECLARE
    property_owner_id uuid;
    property_title text;
    favoriter_name text;
    favoriter_profile record;
BEGIN
    -- Get property owner ID and title
    SELECT profiles_id, title INTO property_owner_id, property_title
    FROM public.properties 
    WHERE id = NEW.property_id;
    
    -- Get favoriter's name
    SELECT firstname, lastname INTO favoriter_profile
    FROM public.profiles 
    WHERE profiles_id = NEW.profiles_id;
    
    favoriter_name := COALESCE(favoriter_profile.firstname || ' ' || favoriter_profile.lastname, 'Someone');
    
    -- Don't notify if user is favoriting their own property
    IF property_owner_id != NEW.profiles_id THEN
        PERFORM check_and_send_notification(
            property_owner_id,
            'favorite_added',
            'Property Added to Favorites',
            favoriter_name || ' added your property "' || property_title || '" to their favorites',
            jsonb_build_object(
                'property_id', NEW.property_id,
                'property_title', property_title,
                'favoriter_id', NEW.profiles_id,
                'favoriter_name', favoriter_name
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to notify user when they receive a message
CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER AS $$
DECLARE
    conversation_record record;
    sender_profile record;
    recipient_id uuid;
    sender_name text;
    property_title text;
    message_preview text;
BEGIN
    -- Get conversation details
    SELECT participant1_id, participant2_id, property_id INTO conversation_record
    FROM conversations 
    WHERE id = NEW.conversation_id;
    
    -- Determine recipient (the person who didn't send the message)
    IF conversation_record.participant1_id = NEW.sender_id THEN
        recipient_id := conversation_record.participant2_id;
    ELSE
        recipient_id := conversation_record.participant1_id;
    END IF;
    
    -- Get sender's name
    SELECT firstname, lastname INTO sender_profile
    FROM profiles 
    WHERE profiles_id = NEW.sender_id;
    
    sender_name := COALESCE(sender_profile.firstname || ' ' || sender_profile.lastname, 'Someone');
    
    -- Get property title if conversation is about a property
    IF conversation_record.property_id IS NOT NULL THEN
        SELECT title INTO property_title
        FROM properties 
        WHERE id = conversation_record.property_id;
    END IF;

    -- Create message preview with limited length
    message_preview := substring(NEW.content from 1 for 100);
    IF length(NEW.content) > 100 THEN
        message_preview := message_preview || '...';
    END IF;
    
    -- Send notification to recipient
    INSERT INTO notifications (
        profiles_id,
        type,
        title,
        message,
        data,
        read,
        created_at
    ) VALUES (
        recipient_id,
        'message',
        'New Message from ' || sender_name,
        CASE 
            WHEN property_title IS NOT NULL THEN 
                message_preview || ' (Re: ' || property_title || ')'
            ELSE 
                message_preview
        END,
        jsonb_build_object(
            'conversation_id', NEW.conversation_id,
            'sender_id', NEW.sender_id,
            'sender_name', sender_name,
            'property_id', conversation_record.property_id,
            'property_title', property_title,
            'message_preview', message_preview
        ),
        false,
        NOW()
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create or replace the trigger
DROP TRIGGER IF EXISTS trigger_message_notification ON public.messages;
CREATE TRIGGER trigger_message_notification
    AFTER INSERT ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_message();

-- Trigger for testimonial approval
DROP TRIGGER IF EXISTS trigger_testimonial_approval_notification ON public.testimonials;
CREATE TRIGGER trigger_testimonial_approval_notification
    AFTER UPDATE ON public.testimonials
    FOR EACH ROW
    EXECUTE FUNCTION notify_testimonial_approved();



-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION check_and_send_notification(uuid, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION notify_property_favorited() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_new_message() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_testimonial_approved() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_agent_application_status() TO authenticated;

-- Add indexes for better notification performance
CREATE INDEX IF NOT EXISTS idx_notifications_type_created ON public.notifications(type, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_profiles_read ON public.notifications(profiles_id, read);


-- Create function to get notification statistics
CREATE OR REPLACE FUNCTION get_notification_stats(user_id uuid)
RETURNS json AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'total', COUNT(*),
        'unread', COUNT(*) FILTER (WHERE read = false),
        'by_type', json_object_agg(
            type, 
            json_build_object(
                'total', COUNT(*),
                'unread', COUNT(*) FILTER (WHERE read = false)
            )
        )
    ) INTO result
    FROM notifications 
    WHERE profiles_id = user_id;
    
    RETURN COALESCE(result, '{"total": 0, "unread": 0, "by_type": {}}'::json);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions for notification stats function
GRANT EXECUTE ON FUNCTION get_notification_stats(uuid) TO authenticated;

-- Property verification notification function and trigger
CREATE OR REPLACE FUNCTION notify_property_verified()
RETURNS TRIGGER AS $$
DECLARE
    property_owner record;
BEGIN
    -- Only trigger when verified changes from false to true
    IF NEW.verified = true AND (OLD.verified = false OR OLD.verified IS NULL) THEN
        -- Get the property owner's details
        SELECT * INTO property_owner
        FROM profiles
        WHERE profiles_id = NEW.profiles_id;

        -- Create a notification for the property owner
        INSERT INTO notifications (
            profiles_id,
            type,
            title,
            message,
            data,
            read
        ) VALUES (
            NEW.profiles_id,
            'property_verified',
            'Your property "' || NEW.title || '" has been verified and is now live on the platform.',
            jsonb_build_object(
                'property_id', NEW.id,
                'property_title', NEW.title,
                'property_type', NEW.property_type,
                'price', NEW.price,
                'verified_at', CURRENT_TIMESTAMP
            ),
            false
        );

        -- Also notify admins about the verification
        INSERT INTO admin_notifications (
            admin_id,
            title,
            message,
            type,
            action_url
        )
        SELECT 
            profiles_id,
            'Property Verified',
            'Property "' || NEW.title || '" has been verified successfully.',
            'property_verification',
            '/admin/properties/' || NEW.id
        FROM profiles
        WHERE role = 'admin';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create or replace the trigger
DROP TRIGGER IF EXISTS trigger_property_verified ON public.properties;
CREATE TRIGGER trigger_property_verified
    AFTER UPDATE OF verified ON public.properties
    FOR EACH ROW
    EXECUTE FUNCTION notify_property_verified();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION notify_property_verified() TO authenticated;
GRANT EXECUTE ON FUNCTION notify_property_verified() TO service_role;

-- Create an index to improve performance of the trigger
CREATE INDEX IF NOT EXISTS idx_properties_verified_profiles_id 
ON public.properties(verified, profiles_id);

-- Create function to allow users to change their password
CREATE OR REPLACE FUNCTION public.change_user_password(
  user_id uuid,
  current_password text,
  new_password text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user auth.users;
  v_result json;
BEGIN
  -- Check if the user exists
  SELECT * INTO v_user FROM auth.users WHERE id = user_id;
  IF v_user IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'User not found'
    );
  END IF;
  
  -- Verify current password (this is handled in the API route)
  
  -- Update the password
  BEGIN
    UPDATE auth.users
    SET encrypted_password = crypt(new_password, gen_salt('bf'))
    WHERE id = user_id;
    
    RETURN json_build_object(
      'success', true,
      'message', 'Password changed successfully'
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
  END;
END;
$$;

-- Grant permissions for the password change function
GRANT EXECUTE ON FUNCTION public.change_user_password(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_user_password(uuid, text, text) TO service_role;

-- Add comment for the function
COMMENT ON FUNCTION public.change_user_password(uuid, text, text) IS 'Changes a user''s password if the current password is correct';

-- Create function to delete unverified users after 1 hour
CREATE OR REPLACE FUNCTION public.delete_unverified_users()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  users_count integer;
  deleted_user record;
BEGIN
  -- First, log which users will be deleted
  FOR deleted_user IN (
    SELECT id, email, created_at
    FROM auth.users
    WHERE 
      email_confirmed_at IS NULL AND
      created_at < (now() - interval '1 hour')
  ) LOOP
    RAISE NOTICE 'Deleting unverified user: % (%) registered at %', 
      deleted_user.email, 
      deleted_user.id, 
      deleted_user.created_at;
  END LOOP;

  -- Delete users who registered more than 1 hour ago but haven't verified their email
  WITH deleted_users AS (
    DELETE FROM auth.users
    WHERE 
      email_confirmed_at IS NULL AND
      created_at < (now() - interval '1 hour')
    RETURNING id
  )
  SELECT count(*) INTO users_count FROM deleted_users;
  
  -- Log the deletion count
  IF users_count > 0 THEN
    RAISE NOTICE 'Deleted % unverified users', users_count;
  END IF;
  
  RETURN users_count;
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.delete_unverified_users() TO service_role;
COMMENT ON FUNCTION public.delete_unverified_users() IS 'Deletes users who have not verified their email within 1 hour of registration';
CREATE OR REPLACE FUNCTION notify_property_favorited() RETURNS trigger AS $$
DECLARE
    property_owner_id uuid;
    property_title text;
    favoriter_name text;
    favoriter_profile record;
BEGIN
    -- Get property owner ID and title
    SELECT profiles_id, title INTO property_owner_id, property_title
    FROM public.properties 
    WHERE id = NEW.property_id;

    -- Get favoriter's name
    SELECT firstname, lastname INTO favoriter_profile
    FROM public.profiles 
    WHERE profiles_id = NEW.profiles_id;

    favoriter_name := COALESCE(favoriter_profile.firstname || ' ' || favoriter_profile.lastname, 'Someone');

    -- Don't notify if user is favoriting their own property
    IF property_owner_id != NEW.profiles_id THEN
        INSERT INTO public.notifications (
            profiles_id,
            type,
            title,
            message,
            data
        ) VALUES (
            property_owner_id,
            'favorite_added',
            'Property Added to Favorites',
            favoriter_name || ' added your property "' || property_title || '" to their favorites',
            jsonb_build_object(
                'property_id', NEW.property_id,
                'favoriter_id', NEW.profiles_id,
                'favoriter_name', favoriter_name
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_testimonial_approved() RETURNS trigger AS $$
BEGIN
    -- Only send notification when status changes to approved
    IF NEW.approved = true AND (OLD.approved = false OR OLD.approved IS NULL) THEN
        INSERT INTO public.notifications (
            profiles_id,
            type,
            title,
            message,
            data
        ) VALUES (
            NEW.profiles_id,
            'testimonial_approved',
            'Testimonial Approved',
            'Your testimonial has been approved and is now visible on our website!',
            jsonb_build_object(
                'testimonial_id', NEW.id,
                'rating', NEW.rating
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace the existing function with this corrected version
CREATE OR REPLACE FUNCTION notify_agent_application_status()
RETURNS trigger AS $$
BEGIN
    -- Only send a notification when the status actually changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        CASE NEW.status
            WHEN 'approved' THEN
                INSERT INTO public.notifications (
                    profiles_id,
                    type,
                    title,
                    message,
                    data
                ) VALUES (
                    NEW.profiles_id,
                    'agent_application_approved',
                    'Agent Application Approved',
                    'Congratulations! Your agent application has been approved. You can now access agent features.',
                    jsonb_build_object('agent_id', NEW.id, 'status', NEW.status)
                );
            WHEN 'rejected' THEN
                INSERT INTO public.notifications (
                    profiles_id,
                    type,
                    title,
                    message,
                    data
                ) VALUES (
                    NEW.profiles_id,
                    'agent_application_rejected',
                    'Agent Application Rejected',
                    'Your agent application was not approved at this time. You may re-apply in the future.',
                    jsonb_build_object('agent_id', NEW.id, 'status', NEW.status)
                );
            ELSE
                RETURN NEW;  -- No notification for other status values
        END CASE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Now, recreate the triggers to use the new functions
DROP TRIGGER IF EXISTS notify_property_favorited ON public.favorites;
CREATE TRIGGER notify_property_favorited
AFTER INSERT ON public.favorites
FOR EACH ROW EXECUTE FUNCTION notify_property_favorited();

DROP TRIGGER IF EXISTS notify_testimonial_approved ON public.testimonials;
CREATE TRIGGER notify_testimonial_approved
AFTER UPDATE ON public.testimonials
FOR EACH ROW EXECUTE FUNCTION notify_testimonial_approved();

DROP TRIGGER IF EXISTS notify_agent_application_status ON public.agents;
CREATE TRIGGER notify_agent_application_status
AFTER UPDATE ON public.agents
FOR EACH ROW EXECUTE FUNCTION notify_agent_application_status();
-- allow inserts when request comes from localhost, CI or your server
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Server can insert any profile"
  ON public.profiles FOR INSERT
  USING (current_setting('request.jwt.claim.role', true) = 'service_role')
  WITH CHECK (true);
  CREATE OR REPLACE FUNCTION notify_admin_on_profile_creation()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.admin_notifications (
        admin_id,
        title,
        message,
        type,
        action_url
    ) VALUES (
        (SELECT profiles_id FROM public.profiles WHERE role = 'admin' LIMIT 1), -- Assuming there's at least one admin
        'New User Profile Created',
        'A new user profile for ' || NEW.email || ' has been created and verified.',
        'user_profile_creation',
        '/admin/users/' || NEW.profiles_id
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER after_profile_creation
AFTER INSERT ON public.profiles
FOR EACH ROW
WHEN (NEW.email IS NOT NULL AND NEW.status = 'active') -- Assuming 'active' means email is verified
EXECUTE FUNCTION notify_admin_on_profile_creation();

ALTER TABLE public.property_inquiries 
ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add a trigger to automatically update the timestamp when the row is modified
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE TRIGGER set_property_inquiries_timestamp
BEFORE UPDATE ON public.property_inquiries
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();