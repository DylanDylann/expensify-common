import _ from 'underscore';
import {Deferred} from 'simply-deferred';
import Str from './str';

/**
 * Actions we should never show on web or mobile, but are required to store in the cache.
 */
const HIDDEN_ACTIONS = [
    'BILLABLEUPDATETRANSACTION',
    'BILLABLEDELEGATE',
    'QUEUEDFOREXPORT',
    'REIMBURSEMENTACHBOUNCEFASTDEBIT',
    'REIMBURSEMENTRETRYDEBIT',
    'DIGITALSIGNATURE'
];

export default class ReportHistoryStore {
    // We need to instantiate the history cache with the platform specific implementations
    constructor(API) {
        this.API = API;

        /**
         * Main report history cache
         * Map of reportIDs with value of report history items array
         */
        this.cache = {};

        /**
        * Filters out actions we never want to display on web or mobile.
        *
        * @param {Object[]} historyItems
        *
        * @returns {Object[]}
        */
        this.filterHiddenActions = historyItems => _.filter(historyItems, historyItem => !_.contains(HIDDEN_ACTIONS, historyItem.actionName) && !Str.startsWith(historyItem.actionName, 'CC'));

        /**
         * Public Methods
         */
        return {
            /**
             * Returns the history for a given report.
             * Note that we are unable to ask for the cached history.
             *
             * @param {Number} reportID
             * @returns {Deferred}
             */
            get: (reportID) => {
                const promise = new Deferred();
                this.get(reportID)
                    .done((reportHistory) => {
                        promise.resolve(this.filterHiddenActions(reportHistory));
                    });
                return promise;
            },

            /**
             * Set a history item directly into the cache. Checks to see if we have the previous item first.
             *
             * @param {Number} reportID
             * @param {Object} reportAction
             *
             * @returns {Deferred}
             */
            set: (reportID, reportAction) => {
                const promise = new Deferred();
                this.getFromCacheFirst(reportID)
                    .done((cachedHistory) => {
                        const sequenceNumber = reportAction.sequenceNumber;

                        // If we have the action in the cache already - just return the history in cache since we're up to date
                        if (_.findWhere(cachedHistory, {sequenceNumber})) {
                            return promise.resolve(this.filterHiddenActions(cachedHistory));
                        }

                        // Do we have the reportAction immediately before this one?
                        if (_.findWhere(cachedHistory, {sequenceNumber: sequenceNumber - 1})) {
                            // If we have the previous one then we can assume we have an up to date history minus the most recent
                            // Unshift it on to the front of the history list and resolve.
                            this.cache[reportID].unshift(reportAction);
                            return promise.resolve(this.filterHiddenActions(this.cache[reportID]));
                        }

                        // If we get here we have an incomplete history and should get
                        // the report history again, but this time do not check the cache first.
                        this.get(reportID)
                            .done(reportHistory => promise.resolve(this.filterHiddenActions(reportHistory)));
                    });

                return promise;
            },

            // We need this to be publically available for cases where we get the report history via PHP pages
            filterHiddenActions: this.filterHiddenActions,
        };
    }

    /**
     * Fetches the entire report history from the API
     *
     * @param {Number} reportID
     *
     * @returns {APIDeferred}
     */
    fetchAll(reportID) {
        return this.API.Report_GetHistory({reportID})
            .done((reportHistory) => {
                this.cache[reportID] = reportHistory;
            });
    }

    /**
     * Merges partial history items into the cache.
     *
     * @param {Number} reportID
     * @param {Object[]} newHistory
     */
    mergeItems(reportID, newHistory) {
        if (newHistory.length === 0) {
            return;
        }

        this.cache[reportID] = _.reduce(newHistory.reverse(), (prev, curr) => {
            if (!_.findWhere(prev, {sequenceNumber: curr.sequenceNumber})) {
                prev.unshift(curr);
            }
            return prev;
        }, this.cache[reportID]);
    }

    /**
     * Gets the history.
     *
     * @param {Number} reportID
     * @param {Boolean} cacheFirst - private usage only
     *
     * @returns {Deferred}
     */
    get(reportID) {
        const promise = new Deferred();
        const cachedHistory = this.cache[reportID] || [];

        // If no cache exists for this report fully load the history.
        if (_.isEmpty(cachedHistory)) {
            this.fetchAll(reportID)
                .done(promise.resolve);
            return promise;
        }

        // Otherwise we'll poll the API for the missing history
        const firstHistoryItem = _.first(cachedHistory) || {};

        // Grab the most recent sequenceNumber we have and poll the API for fresh data
        this.API.Report_GetHistory({
            reportID,
            offset: firstHistoryItem.sequenceNumber || 0
        })
            .done((recentHistory) => {
                // Update history with new items fetched
                this.mergeItems(reportID, recentHistory);

                // Return history for this report
                promise.resolve(this.cache[reportID]);
            });

        return promise;
    }

    /**
     * Gets the history from the cache if it exists. Otherwise fully loads the history.
     *
     * @param {Numberr} reportID
     *
     * @return {Deferrred}
     */
    getFromCacheFirst(reportID) {
        const promise = new Deferred();
        const cachedHistory = this.cache[reportID] || [];

        // First check to see if we even have this history in cache
        if (_.isEmpty(cachedHistory)) {
            this.fetchAll(reportID)
                .done(promise.resolve);
            return promise;
        }

        promise.resolve(cachedHistory);
        return promise;
    }
}
