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

export const EOC_CHECKLIST_TEMPLATE = [
  // Exterior
  { id: 'exterior_body', category: 'Exterior', label: 'Body condition (dents, scratches)' },
  { id: 'exterior_tires', category: 'Exterior', label: 'Tire condition and pressure' },
  { id: 'exterior_lights', category: 'Exterior', label: 'All lights functional (headlights, brake, turn signals)' },
  { id: 'exterior_windows', category: 'Exterior', label: 'Windows and mirrors intact' },
  // Interior
  { id: 'interior_seats', category: 'Interior', label: 'Seats and seatbelts condition' },
  { id: 'interior_cleanliness', category: 'Interior', label: 'Interior cleanliness' },
  { id: 'interior_dashboard', category: 'Interior', label: 'Dashboard indicators normal' },
  { id: 'interior_ac', category: 'Interior', label: 'AC / heating functional' },
  // Fluids
  { id: 'fluids_oil', category: 'Fluids', label: 'Oil level' },
  { id: 'fluids_coolant', category: 'Fluids', label: 'Coolant level' },
  { id: 'fluids_washer', category: 'Fluids', label: 'Windshield washer fluid' },
  // Safety
  { id: 'safety_firstaid', category: 'Safety', label: 'First aid kit present and stocked' },
  { id: 'safety_extinguisher', category: 'Safety', label: 'Fire extinguisher present and charged' },
  { id: 'safety_documents', category: 'Safety', label: 'Registration and insurance documents present' }
]
