/* === EOC Constants — Locations, Vans, Shifts, Checklist Template === */

export const LOCATIONS = [
  { id: 'lone_mountain', label: 'Lone Mountain' },
  { id: 'res', label: 'RES' },
  { id: 'mesquite', label: 'Mesquite' }
]

export const VANS = [
  { id: 'van_1', label: 'Van 1' },
  { id: 'van_2', label: 'Van 2' },
  { id: 'van_3', label: 'Van 3' },
  { id: 'van_4', label: 'Van 4' }
]

export const SHIFTS = [
  { id: 'shift_1', label: '1st Shift', dueDayOfWeek: 0 }, // Sunday
  { id: 'shift_2', label: '2nd Shift', dueDayOfWeek: 3 }  // Wednesday
]

export const VAN_BY_LOCATION = {
  lone_mountain: 'van_2',
  res: 'van_3',
  mesquite: 'van_4'
}

export const EOC_VAN_TEMPLATE = [
  // Vehicle Receiving Inspection — Engine Off Criteria
  { id: 'engine_off_oil', category: 'Engine Off Criteria', label: 'ENGINE OIL WITHIN ACCEPTABLE LIMITS' },
  { id: 'engine_off_belts', category: 'Engine Off Criteria', label: 'FAN BELTS TIGHT AND SHOW NO OBVIOUS DAMAGE' },
  { id: 'engine_off_coolant', category: 'Engine Off Criteria', label: 'COOLANT LEVEL ACCEPTABLE' },
  { id: 'engine_off_tire_tread', category: 'Engine Off Criteria', label: 'TIRE TREAD AND SIDEWALLS SHOW NO DAMAGE' },
  { id: 'engine_off_tire_inflation', category: 'Engine Off Criteria', label: 'TIRE INFLATION' },
  { id: 'engine_off_windows', category: 'Engine Off Criteria', label: 'WINDOWS CLEAN INSIDE AND OUTSIDE' },
  { id: 'engine_off_wipers', category: 'Engine Off Criteria', label: 'WINDSHIELD WIPERS CLEAN AND NOT STUCK TO WINDSHIELD' },
  { id: 'engine_off_seatbelt', category: 'Engine Off Criteria', label: 'SEAT BELT FUNCTIONS CORRECTLY' },
  { id: 'engine_off_kits', category: 'Engine Off Criteria', label: 'EMERGENCY / INCIDENT REPORTING KITS AVAILABLE' },
  { id: 'engine_off_extinguisher', category: 'Engine Off Criteria', label: 'FIRE EXTINGUISHER AVAILABLE' },

  // Vehicle Receiving Inspection — Engine On Criteria
  { id: 'engine_on_headlights', category: 'Engine On Criteria', label: 'HEADLIGHTS FUNCTION ON BOTH HI AND LO BEAMS' },
  { id: 'engine_on_turn_signals', category: 'Engine On Criteria', label: 'TURN SIGNALS FUNCTION' },
  { id: 'engine_on_brake_lights', category: 'Engine On Criteria', label: 'BRAKE LIGHTS FUNCTION INCLUDING THIRD BRAKE LIGHT' },
  { id: 'engine_on_reverse', category: 'Engine On Criteria', label: 'REVERSE LIGHTS / BACK UP ALARM FUNCTIONS' },
  { id: 'engine_on_fluid_leaks', category: 'Engine On Criteria', label: 'FLUID LEAKS DISCOVERED' },
  { id: 'engine_on_horn', category: 'Engine On Criteria', label: 'HORN SOUNDS' },
  { id: 'engine_on_mirrors', category: 'Engine On Criteria', label: 'MIRRORS FUNCTION AND ARE CLEAN' },
  { id: 'engine_on_brakes', category: 'Engine On Criteria', label: 'BRAKES FUNCTION CORRECTLY' },
  { id: 'engine_on_new_damage', category: 'Engine On Criteria', label: 'ANY NEW DAMAGE NOTED PRIOR TO USING THIS VEHICLE?' },
]

export const EOC_HOUSE_TEMPLATE = [
  // Weekly Environment of Care Checklist — Kitchen
  { id: 'kitchen_knives', category: 'Kitchen', label: 'Are all kitchen knives accounted for?' },
  { id: 'kitchen_plumbing', category: 'Kitchen', label: 'Is the plumbing working correctly?' },
  { id: 'kitchen_disposal', category: 'Kitchen', label: 'Does the garbage disposal work properly? Any rancid smells?' },
  { id: 'kitchen_fridge', category: 'Kitchen', label: 'Are the refrigerators organized and operating properly?' },
  { id: 'kitchen_dishwasher', category: 'Kitchen', label: 'Is the dishwasher operating properly?' },
  { id: 'kitchen_food', category: 'Kitchen', label: 'Is the expired food thrown out and adequate food available?' },
  { id: 'kitchen_meal_plan', category: 'Kitchen', label: 'Is the meal plan done and posted in an accessible location?' },
  { id: 'kitchen_appliances', category: 'Kitchen', label: 'Are all appliances in working order?' },

  // Front of house
  { id: 'front_lights', category: 'Front of house', label: 'Are the exterior lights working?' },
  { id: 'front_lock', category: 'Front of house', label: 'Does the lock on the front door operate properly?' },
  { id: 'front_yard', category: 'Front of house', label: 'Is the front yard well maintained?' },

  // Laundry / Linen
  { id: 'laundry_units', category: 'Laundry room/ Washer and Dryers / Linen Closets', label: 'Are the units working properly?' },
  { id: 'laundry_leaks', category: 'Laundry room/ Washer and Dryers / Linen Closets', label: 'Is anything leaking?' },
  { id: 'laundry_folded', category: 'Laundry room/ Washer and Dryers / Linen Closets', label: 'Is the house laundry washed and folded?' },
  { id: 'laundry_chemicals', category: 'Laundry room/ Washer and Dryers / Linen Closets', label: 'Are all chemicals organized, accessible and well stocked?' },
  { id: 'laundry_bedding', category: 'Laundry room/ Washer and Dryers / Linen Closets', label: 'Is the house equipped with adequate bedding, pillows, etc?' },
  { id: 'laundry_organized', category: 'Laundry room/ Washer and Dryers / Linen Closets', label: 'Are these areas organized and well maintained?' },

  // Bathrooms
  { id: 'bathroom_plumbing', category: 'Bathrooms', label: 'Is the plumbing working correctly (sinks, showers, toilets)?' },
  { id: 'bathroom_supplies', category: 'Bathrooms', label: 'Sufficient soap and hand towels available?' },
  { id: 'bathroom_clean', category: 'Bathrooms', label: 'Are the bathrooms clean and organized?' },

  // Back of house / Outside
  { id: 'back_bbq', category: 'Back of house/Outside', label: 'Are the BBQs in working order with filled propane tanks?' },
  { id: 'back_litter', category: 'Back of house/Outside', label: 'Is the area free of litter and well maintained?' },
  { id: 'back_lighting', category: 'Back of house/Outside', label: 'Does the outside lighting work properly?' },
  { id: 'back_pools', category: 'Back of house/Outside', label: 'Are the pools and recreational equipment clean and working?' },

  // General Areas / Bedrooms
  { id: 'general_dangerous_items', category: 'General Areas/ Bedrooms', label: 'Are all dangerous items properly secured (sharps, tools, non allowables)?' },
  { id: 'general_lights_locks', category: 'General Areas/ Bedrooms', label: 'Are lights/locks working throughout the home?' },
  { id: 'general_cameras', category: 'General Areas/ Bedrooms', label: 'Are the camera’s working/charged?' },
  { id: 'general_remotes', category: 'General Areas/ Bedrooms', label: 'Are all of the remotes accounted for?' },
  { id: 'general_progress_board', category: 'General Areas/ Bedrooms', label: 'Is the progress board up to date?' },
  { id: 'general_chores', category: 'General Areas/ Bedrooms', label: 'Are chores properly assigned?' },
  { id: 'general_unoccupied_beds', category: 'General Areas/ Bedrooms', label: 'Are all unoccupied beds/bedrooms clean and prepped' },
  { id: 'general_clients_bedrooms', category: 'General Areas/ Bedrooms', label: 'Are all clients bedrooms/bathrooms clean and organized' },

  // Gym / Garage
  { id: 'gym_clean', category: 'Gym/Garage', label: 'Are the areas clean and well maintained?' },
  { id: 'gym_equipment', category: 'Gym/Garage', label: 'Is all equipment/machinery in working order?' },
  { id: 'gym_doors', category: 'Gym/Garage', label: 'Are garage doors working?' }
]

export const EOC_CHECKLIST_TEMPLATE = [
  ...EOC_VAN_TEMPLATE,
  ...EOC_HOUSE_TEMPLATE
]
