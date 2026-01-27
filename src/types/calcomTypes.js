/**
 * @typedef {Object} HealthResponse
 * @property {"healthy"} status
 * @property {string} timestamp ISO8601
 */

/**
 * @typedef {Object} TestCalcomResponse
 * @property {"connected"|"failed"|"error"} status
 * @property {string} timestamp ISO8601
 * @property {string=} message
 */

/**
 * @typedef {Object} DateResponse
 * @property {string} currentDate ISO8601
 * @property {number} timestamp
 * @property {string=} timezone
 * @property {string} utcDate ISO8601
 */

/**
 * @typedef {Object} SlotItem
 * @property {string} start
 * @property {string} end
 * @property {boolean} available
 */

/**
 * @typedef {Object} SlotsAvailableResponse
 * @property {SlotItem[]} slots
 * @property {string} eventTypeId
 * @property {{start: string, end: string}} dateRange
 */

/**
 * @typedef {Object} ReservationResponse
 * @property {string} reservationId
 * @property {"confirmed"|"pending"|"cancelled"} status
 * @property {{start: string, end: string, eventTypeId: string}} eventDetails
 * @property {{name: string, email: string}} attendee
 */
