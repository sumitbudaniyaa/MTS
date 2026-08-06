import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBaseTransforms } from './_shared.js';

/**
 * Operational timings, editable by an admin at runtime instead of requiring a redeploy.
 * Exactly one document ever exists — the fixed `_id` makes that an invariant the database
 * enforces rather than something the code has to remember.
 *
 * Read through `config/settings.ts`, never directly: hot paths (seat maps, movie listings)
 * need these values synchronously and must not hit Mongo on every call.
 */
export const SETTINGS_ID = 'app';

const settingsSchema = new Schema(
  {
    _id: { type: String, default: SETTINGS_ID },
    // How long before showtime seats become bookable.
    visibilityLeadMinutes: { type: Number, required: true, min: 1, max: 20_160 },
    // How long a ticket holder has to check in before their seat is reclaimed. Measured from
    // showtime, or from the booking itself for seats taken after the show has started.
    noShowGraceMinutes: { type: Number, required: true, min: 1, max: 1_440 },
    // How long a seat stays held while the user is completing a booking.
    seatHoldSeconds: { type: Number, required: true, min: 15, max: 3_600 },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, versionKey: false, _id: false },
);

export type Settings = InferSchemaType<typeof settingsSchema>;
export type SettingsDoc = HydratedDocument<Settings>;

applyBaseTransforms(settingsSchema);

export const SettingsModel = model('Settings', settingsSchema);
