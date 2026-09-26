'use strict';

const Joi = require('joi');

/**
 * Joi validation schema for POST /api/pack
 *
 * Enforces the full input contract before the payload
 * ever reaches the Python solver.
 */

const binSchema = Joi.object({
  name:       Joi.string().trim().min(1).required()
                .description('Unique identifier for this bin (e.g. "euro-pallet")'),
  width:      Joi.number().positive().required()
                .description('Inner width in cm'),
  height:     Joi.number().positive().required()
                .description('Inner height in cm'),
  depth:      Joi.number().positive().required()
                .description('Inner depth in cm'),
  max_weight: Joi.number().positive().default(999999)
                .description('Maximum load weight in kg'),
});

const itemSchema = Joi.object({
  name:           Joi.string().trim().min(1).required()
                    .description('Item type identifier (e.g. "master-carton")'),
  width:          Joi.number().positive().required()
                    .description('Width in cm'),
  height:         Joi.number().positive().required()
                    .description('Height in cm'),
  depth:          Joi.number().positive().required()
                    .description('Depth in cm'),
  weight:         Joi.number().min(0).default(0)
                    .description('Weight in kg'),
  quantity:       Joi.number().integer().min(1).default(1)
                    .description('How many physical copies of this item to pack'),
  allow_rotation: Joi.boolean().default(true)
                    .description('Whether the item can be rotated'),
});

const optionsSchema = Joi.object({
  bigger_first:       Joi.boolean().default(true)
                        .description('Pack larger items first (recommended)'),
  distribute_items:   Joi.boolean().default(false)
                        .description('Distribute items evenly across bins'),
  number_of_decimals: Joi.number().integer().min(0).max(6).default(0)
                        .description('Decimal precision for output coordinates'),
});

const packSchema = Joi.object({
  bins:    Joi.array().items(binSchema).min(1).required()
             .description('List of available containers'),
  items:   Joi.array().items(itemSchema).min(1).required()
             .description('List of item types to pack'),
  options: optionsSchema.default(),
});

module.exports = packSchema;
