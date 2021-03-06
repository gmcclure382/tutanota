//"use strict";

tutao.provide('tutao.tutanota.ctrl.MailListViewModel');

/**
 * The list of mail headers on the left.
 * The context of all methods is re-bound to this for allowing the ViewModel to be called from event Handlers that might get executed in a different context.
 * @constructor
 * @implements {tutao.tutanota.ctrl.bubbleinput.BubbleHandler}
 */
tutao.tutanota.ctrl.MailListViewModel = function() {
	tutao.util.FunctionUtils.bindPrototypeMethodsToThis(this);

	/* the currently selected dom elements for mails */
	this._selectedDomElements = [];
	/* the mails corresponding to the currently selected dom elements */
	this._selectedMails = [];
	this._lastSelectedMail = {}; // map from tag to last selected mail; stored to make visible when a new mail was sent/canceled

	this._multiSelect = false;

	// the list of mail ids as result of the currently active search query. if null, there is no search query active.
	this.currentSearchResult = null;

	this._currentActiveSystemTag = ko.observable(tutao.tutanota.ctrl.TagListViewModel.RECEIVED_TAG_ID);
	// the list of mail ids as result of the currently active tag filters. if null, there is no filter set. each tag has one entry in the array.
	this.currentTagFilterResult = [];
	this.currentTagFilterResult[tutao.tutanota.ctrl.TagListViewModel.RECEIVED_TAG_ID] = [];
	this.currentTagFilterResult[tutao.tutanota.ctrl.TagListViewModel.SENT_TAG_ID] = [];
	this.currentTagFilterResult[tutao.tutanota.ctrl.TagListViewModel.TRASHED_TAG_ID] = [];

	this.tagToMailAttributeIdMapping = [];
	this.tagToMailAttributeIdMapping[tutao.tutanota.ctrl.TagListViewModel.RECEIVED_TAG_ID] = tutao.entity.tutanota.Mail.prototype.STATE_ATTRIBUTE_ID;
	this.tagToMailAttributeIdMapping[tutao.tutanota.ctrl.TagListViewModel.SENT_TAG_ID] = tutao.entity.tutanota.Mail.prototype.STATE_ATTRIBUTE_ID;
	this.tagToMailAttributeIdMapping[tutao.tutanota.ctrl.TagListViewModel.TRASHED_TAG_ID] = tutao.entity.tutanota.Mail.prototype.TRASHED_ATTRIBUTE_ID;

	this.tagToMailAttributeMapping = [];
	this.tagToMailAttributeMapping[tutao.tutanota.ctrl.TagListViewModel.RECEIVED_TAG_ID] = "_state";
	this.tagToMailAttributeMapping[tutao.tutanota.ctrl.TagListViewModel.SENT_TAG_ID] = "_state";
	this.tagToMailAttributeMapping[tutao.tutanota.ctrl.TagListViewModel.TRASHED_TAG_ID] = "_trashed";

	this.tagToMailAttributeValueMapping = [];
	this.tagToMailAttributeValueMapping[tutao.tutanota.ctrl.TagListViewModel.RECEIVED_TAG_ID] = tutao.entity.tutanota.TutanotaConstants.MAIL_STATE_RECEIVED;
	this.tagToMailAttributeValueMapping[tutao.tutanota.ctrl.TagListViewModel.SENT_TAG_ID] = tutao.entity.tutanota.TutanotaConstants.MAIL_STATE_SENT;
	this.tagToMailAttributeValueMapping[tutao.tutanota.ctrl.TagListViewModel.TRASHED_TAG_ID] = true;   // trashed = true

    this._tagMoreAvailable = [];
    this._tagMoreAvailable[tutao.tutanota.ctrl.TagListViewModel.RECEIVED_TAG_ID] = ko.observable(true);
    this._tagMoreAvailable[tutao.tutanota.ctrl.TagListViewModel.SENT_TAG_ID] = ko.observable(true);
    this._tagMoreAvailable[tutao.tutanota.ctrl.TagListViewModel.TRASHED_TAG_ID] = ko.observable(true);

	// ===== SEARCH ========

	this.bubbleInputViewModel = new tutao.tutanota.ctrl.bubbleinput.BubbleInputViewModel(this);

	this.bubbleInputViewModel.bubbles.subscribe(function() {
		//this.search();
	}, this);

	// ===== SEARCH ========

	this.mails = ko.observableArray();

	// the mail id (Array.<string>) of the email that shall be shown when init() is called
	this.mailToShow = null;
    this.loading = ko.observable(false);
    this.deleting = ko.observable(false);

    this.searchBarVisible = ko.observable(false);
    this.searchButtonVisible = ko.observable(false);

    this.buttonBarViewModel = null;

    this.showSpinner = ko.computed(function () {
        return this.deleting();
    }, this);

    this.moreAvailable = ko.computed(function() {
        return this._tagMoreAvailable[this._currentActiveSystemTag()]();
    }, this);

    this.stepRangeCount = 25;
};


/**
 * Creates the buttons
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.init = function() {
    this.buttons = [
        new tutao.tutanota.ctrl.Button("deleteTrash_action", 10, this._deleteTrash, this.isDeleteTrashButtonVisible, false, "deleteTrashAction", "trash"),
        new tutao.tutanota.ctrl.Button("newMail_action", 10, tutao.locator.navigator.newMail, function() {
            return tutao.locator.userController.isInternalUserLoggedIn() && !tutao.locator.mailView.isConversationColumnVisible();
        }, false, "newMailAction", "mail-new")
    ];
    this.buttonBarViewModel = new tutao.tutanota.ctrl.ButtonBarViewModel(this.buttons, null, tutao.tutanota.gui.measureActionBarEntry, tutao.tutanota.ctrl.ButtonBarViewModel.TYPE_ACTION);
    var self = this;
    tutao.locator.mailView.getSwipeSlider().getViewSlider().addWidthObserver(tutao.tutanota.gui.MailView.COLUMN_MAIL_LIST, function (width) {
        // we reduce the max width by 10 px which are used in our css for paddings + borders
        self.buttonBarViewModel.setButtonBarWidth(width - 6);
    });
};


/**
 * Initialize the MailListViewModel:
 * <ul>
 *   <li>Load the Mails to display from the server
 *   <li>register as an observer to the mail list
 * </ul>
 * @return {Promise} When loading is finished.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.loadInitial = function() {
    var self = this;
    if (tutao.tutanota.util.ClientDetector.isMobileDevice()){
        this.stepRangeCount = 25;
    } else {
        this.stepRangeCount = 200;
    }
    this.searchButtonVisible(tutao.locator.dao.isSupported() && tutao.locator.viewManager.isInternalUserLoggedIn());
    return this.loadMoreMails().then(function() {
        if (tutao.locator.userController.isExternalUserLoggedIn()) {
            if (self.mailToShow) {
                return tutao.entity.tutanota.Mail.load(self.mailToShow).then(function(mail) {
                    return self.selectMail(mail);
                });
            } else {
                if (self.mails().length > 0) {
                    return self.selectMail(self.mails()[0]);
                } else {
                    return Promise.resolve();
                }
            }
        } else {
            var eventTracker = new tutao.event.PushListEventTracker(tutao.entity.tutanota.Mail, tutao.locator.mailBoxController.getUserMailBox().getMails(), "Mail");
            eventTracker.addObserver(self.updateOnNewMails);
            eventTracker.observeList(self._getHighestMailId());
            return Promise.resolve();
        }
    });
};


tutao.tutanota.ctrl.MailListViewModel.prototype.loadMoreMails = function() {
    var self = this;

    if (this.loading() || this.deleting()) {
        return Promise.resolve();
    }
    this.loading(true);
    var tagId = self._currentActiveSystemTag();
    var lowestId = self._getLowestMailId(tagId);
    //return Promise.delay(5000).then(function(){
        return self._loadMoreMails(0, lowestId, tagId).lastly(function(){
            self.loading(false);
            self._updateNumberOfUnreadMails();
        });
    //});
};

tutao.tutanota.ctrl.MailListViewModel.prototype._loadMoreMails = function(alreadyLoadedForTagCount, startId, tagId) {
    var self = this;
    return tutao.entity.tutanota.Mail.loadRange(tutao.locator.mailBoxController.getUserMailBox().getMails(), startId, self.stepRangeCount, true).then(function(mails) {
        self._tagMoreAvailable[tagId](mails.length == self.stepRangeCount);
        for (var i = 0; i < mails.length; i++) {
            if (tagId == self._getTagForMail(mails[i])) {
                var elementId = tutao.rest.EntityRestInterface.getElementId(mails[i]);
                self._insertTagFilterResult(tagId, elementId);
                alreadyLoadedForTagCount++;
            }
            if (alreadyLoadedForTagCount == self.stepRangeCount) {
                // we may have loaded more mails, but we have already added enough for the current tag list, so stop now
                break;
            }
        }
        if ((alreadyLoadedForTagCount < self.stepRangeCount) && self._tagMoreAvailable[tagId]()) {
            var startId = tutao.rest.EntityRestInterface.getElementId(mails[mails.length-1]);
            return self._loadMoreMails(alreadyLoadedForTagCount, startId, tagId);
        } else {
			return self._updateMailList().then(function(){
                self.selectPreviouslySelectedMail(true);
            });
        }
    });
};

tutao.tutanota.ctrl.MailListViewModel.prototype._insertTagFilterResult = function(tagId, elementId){
    if (!tutao.util.ArrayUtils.contains(this.currentTagFilterResult[tagId], elementId)) {
        this.currentTagFilterResult[tagId].push(elementId);
        // sort the array by mail id descending
        this.currentTagFilterResult[tagId].sort(function(a, b) {
            return (tutao.rest.EntityRestInterface.firstBiggerThanSecond(a, b)) ? -1 : 1;
        });
    }
};


/**
 * Provides the string to show in the mail list of the given mail for the sender/recipient field.
 * @param {tutao.entity.tutanota.Mail} mail The mail.
 * @return {string} The string.
 */
tutao.tutanota.ctrl.MailListViewModel.getListSenderOrRecipientString = function(mail) {
	var label = null;
	if (mail.getState() == tutao.entity.tutanota.TutanotaConstants.MAIL_STATE_SENT) {
		var allRecipients = mail.getToRecipients().concat(mail.getCcRecipients()).concat(mail.getBccRecipients());
		if (allRecipients[0].getAddress() == tutao.locator.userController.getMailAddress()) {
			label = tutao.locator.languageViewModel.get("meNominative_label");
		} else if (allRecipients[0].getName() != "") {
			label = allRecipients[0].getName();
		} else {
			label = allRecipients[0].getAddress();
		}
		if (allRecipients.length > 1) {
			label += ", ...";
		}
	} else if (mail.getState() == tutao.entity.tutanota.TutanotaConstants.MAIL_STATE_RECEIVED) {
		if (mail.getSender().getAddress() == tutao.locator.userController.getMailAddress()) {
			label = tutao.locator.languageViewModel.get("meNominative_label");
		} else if (mail.getSender().getName() != "") {
			label = mail.getSender().getName();
		} else {
			label = mail.getSender().getAddress();
		}
	}
	return label;
};

/**
 * Called when a different tag was activated. Updates the mail list accordingly.
 * @param {number} tagId Id of the changed tag.
 * @return {Promise.<>} Resolved when finished, rejected if failed.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.systemTagActivated = function(tagId) {
    var self = this;
	this.unselectAll();
	this._currentActiveSystemTag(tagId);
    return this._updateMailList().then(function() {
        self.selectPreviouslySelectedMail(true);
        tutao.locator.mailView.showDefaultColumns();
        // load more mails if there are not enough shown for this tag
        if (self.moreAvailable() && self.currentTagFilterResult[tagId].length < self.stepRangeCount) {
            return self.loadMoreMails();
        } else {
            return Promise.resolve();
        }
    });
};


tutao.tutanota.ctrl.MailListViewModel.prototype.isDeleteTrashButtonVisible = function() {
     return this._currentActiveSystemTag() == tutao.tutanota.ctrl.TagListViewModel.TRASHED_TAG_ID && this.mails().length > 0;
};


/**
 * Updates the mail list according to the current search and tag filter results.
 * @return {Promise.<>} Resolved when finished, rejected if failed.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype._updateMailList = function() {
	var self = this;

	var currentResult = this.currentTagFilterResult[this._currentActiveSystemTag()].slice();

	var loadedMails = [];

	return self._loadMails(currentResult, loadedMails, 0).then(function() {
		self.mails(loadedMails);
	});
};

/**
 * Selects the mail that has been selected before for the current tag.
 * @param {boolean} tryCancelComposingMails True if all existing composing mails should be canceled
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.selectPreviouslySelectedMail = function(tryCancelComposingMails) {
	var lastSelected = this.getLastSelectedMail();
	if (lastSelected) {
        this._selectMail(lastSelected, tutao.locator.mailView.getMailListDomElement(lastSelected), false, tryCancelComposingMails);
	} else {
        tutao.locator.mailViewModel.hideMail();
	}
};

/**
 * Loads the mails with the given ids in the given order. Uses recoursion to load all mails.
 * @param {Array.<Array.<String>>} mailIds The ids of the mails to load.
 * @param {Array.<tutao.entity.tutanota.Mail>} loadedMails An array that contains all mails that are loaded up to now.
 * @param {number} nextMail The index of the mail id in mailIds that shall be loaded next.
 * @return {Promise.<Array.<tutao.entity.tutanota.Mail>>} Resolves to the loaded mails, rejected if failed.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype._loadMails = function(mailIds, loadedMails, nextMail) {
	if (mailIds.length == 0) {
		return Promise.resolve();
	}
	var self = this;
	return tutao.entity.tutanota.Mail.load([tutao.locator.mailBoxController.getUserMailBox().getMails(), mailIds[nextMail]]).then(function(mail) {
        loadedMails.push(mail);
	}).lastly(function(e) {
        // move on, even if an exception occured.
        if (nextMail != mailIds.length - 1) {
            return self._loadMails(mailIds, loadedMails, nextMail + 1);
        }
    });
};


/**
 * This method gets invoked if new mails have been received from the server.
 * @param {Array.<Mail>} mails The mails that are new.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.updateOnNewMails = function(mails) {
    var mailReceived = false;
	for (var i = 0; i < mails.length; i++) {
        if (mails[i].getState() == tutao.entity.tutanota.TutanotaConstants.MAIL_STATE_RECEIVED) {
            mailReceived = true;
        }
        var mailTagId = this._getTagForMail(mails[i]);
        this.currentTagFilterResult[mailTagId].unshift(mails[i].getId()[1]);
        if (this._currentActiveSystemTag() == mailTagId) {
            this.mails.unshift(mails[i]);
        }
	}
    if (mailReceived) {
        tutao.locator.notification.add(tutao.lang("newMails_msg"));
        this._updateNumberOfUnreadMails();
    }
};

tutao.tutanota.ctrl.MailListViewModel.prototype._getTagForMail = function(mail) {
    for (var tagId = 0; tagId < this.currentTagFilterResult.length; tagId++) {
        var mailAttribute = this.tagToMailAttributeMapping[tagId];
        var mailTagValue = mail[mailAttribute];
        if (this.tagToMailAttributeValueMapping[tagId] == mailTagValue) {
            return tagId;
        }
    }
    throw new Error("no tag found for mail " + mail.getId()[0] + "/" + mail.getId()[1]);
};

/**
 * Shows the mail with the given index in the mail view. If the index does not exist, the first index is shown.
 * If no mail exists, no mail is shown.
 * @param index The index to show.
 * @return {Promise} When the mail is shown.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.showIndex = function(index) {
	if (this.mails().length == 0) {
        tutao.locator.mailViewModel.hideMail();
		return Promise.resolve();
	} else {
        if (index < 0) {
            index = 0;
        } else if (index >= this.mails().length) {
            index = this.mails().length - 1;
        }
        return this.selectMail(this.mails()[index]);
    }
};

/**
 * Shows the given mail in the mail view but does not switch to the conversation column.
 * @param mail The mail to show.
 * @return {Promise} When the mail is selected or selection was cancelled.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.selectMail = function(mail) {
	return this._selectMail(mail, tutao.locator.mailView.getMailListDomElement(mail), false, true);
};

/**
 * Shows the given mail in the mail view and switches to the conversation column.
 * @param mail The mail to show.
 * @param {Event} event The click event.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.selectMailAndSwitchToConversationColumn = function(mail, event) {
	this._selectMail(mail, event.currentTarget, true, true);
};

/**
 * Selects the given mail and shows it in the conversation column. Switches to the conversation column depending on the switchToConversationColumn param.
 * @param {tutao.entity.tutanota.Mail} mail Mail to select.
 * @param {Object} domElement dom element of the mail.
 * @param {boolean} switchToConversationColumn True if we shall switch.
 * @param {boolean} tryCancelComposingMails True if all existing composing mails should be canceled
 * @return {Promise} When the mail is selected or selection was cancelled.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype._selectMail = function(mail, domElement, switchToConversationColumn, tryCancelComposingMails) {
    var self = this;
    var promise = null;
    if (tryCancelComposingMails) {
        promise = tutao.locator.mailViewModel.tryCancelAllComposingMails();
    } else {
        promise = Promise.resolve(true);
    }

    return promise.then(function(allCancelled) {
        if (allCancelled) {
            if (mail.getUnread()) {
                mail.setUnread(false);
                mail.update();
                self._updateNumberOfUnreadMails();
            }

            if (self._multiSelect) {
            } else {
                if (self._selectedMails.length > 0 && mail == self._selectedMails[0]) {
                    tutao.locator.mailView.showConversationColumn();
                } else {
                    tutao.tutanota.gui.unselect(self._selectedDomElements);
                    self._selectedDomElements = [domElement];
                    self._selectedMails = [mail];
                    tutao.tutanota.gui.select(self._selectedDomElements);
                    tutao.locator.mailViewModel.showMail(mail);
                    if (switchToConversationColumn) {
                        tutao.locator.mailView.showConversationColumn(function() {});
                    }
                }
            }
        }
        return Promise.resolve();
    });

};

/**
 * Provides the information if a mail is selected.
 * @return {boolean} True if a mail is selected, false otherwise.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.isMailSelected = function() {
	return (this._selectedMails.length != 0);
};

/**
 * Deselects all mails and remembers the last selected mail.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.unselectAll = function() {
	if (this._selectedMails.length == 1) {
		this._lastSelectedMail[this._currentActiveSystemTag()] = this._selectedMails[0];
	}
	tutao.tutanota.gui.unselect(this._selectedDomElements);
	this._selectedDomElements = [];
	this._selectedMails = [];
};

/**
 * Provides the last selected mail or null if none was selected.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.getLastSelectedMail = function() {
	if (this._lastSelectedMail[this._currentActiveSystemTag()] && this.mails.indexOf(this._lastSelectedMail[this._currentActiveSystemTag()]) != -1) {
		return this._lastSelectedMail[this._currentActiveSystemTag()];
	} else {
		return null;
	}
};

/**
 * Shows the previous mail in the list.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.selectPreviousMail = function() {
    if (!this.isMailSelected()) {
        return;
    }

    for (var i=1; i<this.mails().length; i++) {
        if (this.mails()[i] == this._selectedMails[0]) {
            this._selectMail(this.mails()[i - 1], tutao.locator.mailView.getMailListDomElement(this.mails()[i - 1]), false, true);
            break;
        }
    }
};

/**
 * Shows the next mail in the list.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.selectNextMail = function() {
    if (!this.isMailSelected()) {
        return;
    }

    for (var i=0; i<this.mails().length - 1; i++) {
        if (this.mails()[i] == this._selectedMails[0]) {
            this._selectMail(this.mails()[i + 1], tutao.locator.mailView.getMailListDomElement(this.mails()[i + 1]), false, true);
            break;
        }
    }
};

/**
 * Returns true if the first mail in the list is selected, false otherwise.
 * @return {bool} True if the last first in the list is selected, false otherwise.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.isFirstMailSelected = function() {
    return this.isMailSelected() && this.mails()[0] == this._selectedMails[0];
};


/**
 * Returns true if the last mail in the list is selected, false otherwise.
 * @return {bool} True if the last mail in the list is selected, false otherwise.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.isLastMailSelected = function() {
    return this.isMailSelected() && this.mails()[this.mails().length - 1] == this._selectedMails[0];
};

tutao.tutanota.ctrl.MailListViewModel.prototype.getSelectedMailIndex = function() {
    if (!this.isMailSelected()) {
        return 0;
    }

    for (var i=0; i<this.mails().length; i++) {
        if (this.mails()[i] == this._selectedMails[0]) {
            return i;
        }
    }

    return 0;
};

/**
 * Trashes/untrashes all the given mails. updates the mail list view accordingly.
 * @param {Array.<Array<String>>} mailIds The mails to delete finally.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.finallyDeleteMails = function(mailIds) {
    var self = this;
    var service = new tutao.entity.tutanota.DeleteMailData();
    tutao.util.ArrayUtils.addAll(service.getMails(), mailIds);
    return service.erase({}, tutao.entity.EntityHelper.createAuthHeaders()).then(function(deleteMailReturn) {
        for (var i=0; i<mailIds.length; i++) {
            for(var tagIndex = 0; tagIndex < self.currentTagFilterResult.length; tagIndex++){
                tutao.util.ArrayUtils.remove(self.currentTagFilterResult[tagIndex], mailIds[i][1]);
            }
        }
        self.unselectAll();
        return self._updateMailList().then(function(){
            self.selectPreviouslySelectedMail(true);
        });
    });
};


/**
 * Executes the delete trash functionality.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype._deleteTrash = function() {
    if (this.loading() || this.deleting()) {
        return Promise.resolve();
    }

    var self = this;
    tutao.tutanota.gui.confirm(tutao.lang('confirmDeleteTrash_msg')).then(function(ok) {
        if (ok) {
            self.deleting(true);
            // we want to delete all mails in the trash, not only the visible ones, so load them now. load reverse to avoid caching errors
            return tutao.rest.EntityRestInterface.loadAllReverse(tutao.entity.tutanota.Mail, tutao.locator.mailBoxController.getUserMailBox().getMails()).then(function(allMails) {
                var mailsToDelete = [];
                for (var i = 0; i < allMails.length; i++) {
                    if (allMails[i].getTrashed()) {
                        mailsToDelete.push(allMails[i].getId());
                    }
                }
                return self.finallyDeleteMails(mailsToDelete);
            }).lastly(function() {
                self.deleting(false);
            });
        }
    });
};


/**
 * Trashes/untrashes all the given mails. updates the mail list view accordingly.
 * @param {Array.<tutao.entity.tutanota.Mail>} mails The mails to delete or undelete.
 * @param {boolean} trash If true, the mail is trashed, otherwise it is untrashed.
 * @return {window.Promise.<>} Resolved when finished.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.trashMail = function(mails, trash) {
	return this._trashNextMail(mails, 0, trash, false);
};

/**
 * @protected
 * Trashes/untrashes all mails passed as first argument.
 * @param {Array.<tutao.entity.tutanota.Mail>} mails The mails to trash.
 * @param {number} index The index of the first mail to trash.
 * @param {boolean} trash If true, the mail is trashed, otherwise it is untrashed.
 * @param {boolean} attributeChanged Indicates if a trash attribute of any mail was changed so far.
 * When all selected mails are finished, if any was trashed/untrashed, this value is true.
 * @return {window.Promise.<>} Resolved when finished.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype._trashNextMail = function(mails, index, trash, attributeChanged) {
	var self = this;
	var mail = mails[index];
	if (mail.getTrashed() != trash) {
		mail.setTrashed(trash);
		mail.update();
        return new window.Promise(function(resolve, reject) {
            try  {
                // make the icon in the gui visible/invisible if the mail stays in the list. currently it doesn't
                // update the filter results
                for (var tagId = 0; tagId < self.currentTagFilterResult.length; tagId++) {
                    if ((tagId == tutao.tutanota.ctrl.TagListViewModel.TRASHED_TAG_ID) == trash) {
                        // we need to add the mail id if it is the correct state value and if the mail is in the loaded range or all mails have been loaded
                        var lowestId = self._getLowestMailId(tagId);
                        if (mail[self.tagToMailAttributeMapping[tagId]] == self.tagToMailAttributeValueMapping[tagId] &&
                            (tutao.rest.EntityRestInterface.firstBiggerThanSecond(mail.getId()[1], lowestId) || !self._tagMoreAvailable[tagId]())) {
                            self._insertTagFilterResult(tagId, mail.getId()[1]);
                        }
                    } else {
                        // we need to remove the mail id
                        tutao.util.ArrayUtils.remove(self.currentTagFilterResult[tagId], mail.getId()[1]);
                    }
                }

                if (index == mails.length - 1) {
                    // when the mails are removed from the list select the first mail if multiple mails have been trashed and
                    // select the next mail if one mail has been trashed
                    var nextSelectedIndex = 0;
                    if (mails.length == 1) {
                        nextSelectedIndex = self.mails.indexOf(mails[index]);
                    }
                    resolve(self._updateMailList().then(function() {
                        return self.showIndex(nextSelectedIndex);
                    }));
                } else {
                    resolve(self._trashNextMail(mails, ++index, trash, true));
                }
            } catch (exception) {
                reject(exception);
            }
        });

	} else {
		if (index == mails.length - 1) {
			// when the mails are removed from the list select the first mail if multiple mails have been trashed and
			// select the next mail if one mail has been trashed
			var nextSelectedIndex = 0;
			if (mails.length == 1) {
				nextSelectedIndex = self.mails.indexOf(mails[index]);
			}
			return self._updateMailList().then(function() {
				return self.showIndex(nextSelectedIndex);
			});
		} else {
			return self._trashNextMail(mails, ++index, trash, attributeChanged);
		}
	}
};

tutao.tutanota.ctrl.MailListViewModel.prototype._getLowestMailId = function(tagId) {
    var lowestId = tutao.rest.EntityRestInterface.GENERATED_MAX_ID;
    if (this.currentTagFilterResult[tagId].length > 0) {
        lowestId = this.currentTagFilterResult[tagId][this.currentTagFilterResult[tagId].length -1];
    }
    return lowestId;
};

tutao.tutanota.ctrl.MailListViewModel.prototype._getHighestMailId = function() {
    var highestId = tutao.rest.EntityRestInterface.GENERATED_MIN_ID;
	for(var tagIndex = 0; tagIndex < this.currentTagFilterResult.length; tagIndex++){
		if (this.currentTagFilterResult[tagIndex].length > 0) {
			var highestIdInTagList = this.currentTagFilterResult[tagIndex][0];
			if (tutao.rest.EntityRestInterface.firstBiggerThanSecond(highestIdInTagList, highestId)){
				highestId = highestIdInTagList;
			}
		}
	}
    return highestId;
};

/**
 * Requests for validity from the search field.
 * @param {string} text The text to validate.
 * @return {Object<text, colorId>} The validated text and color id.
 */
tutao.tutanota.ctrl.MailListViewModel.prototype.validateBubbleText = function(text) {
	return {text: text, colorId: 0};
};

tutao.tutanota.ctrl.MailListViewModel.prototype.showSearchBar = function() {
    this.searchBarVisible(true);
};

tutao.tutanota.ctrl.MailListViewModel.prototype.hideSearchBar = function() {
    this.searchBarVisible(false);
};


tutao.tutanota.ctrl.MailListViewModel.prototype._updateNumberOfUnreadMails = function() {
    var mailIdList = this.currentTagFilterResult[tutao.tutanota.ctrl.TagListViewModel.RECEIVED_TAG_ID];
    var unreadMails = 0;
    var mailListId = tutao.locator.mailBoxController.getUserMailBox().getMails();
    return Promise.each(mailIdList, function(mailElementId) {
        return tutao.entity.tutanota.Mail.load([mailListId, mailElementId]).then(function(mail) {
            if (mail.getUnread()) {
                unreadMails++;
            }
        });
    }).then(function() {
        var buttons = tutao.locator.viewManager.getButtons();
        for (var i=0; i< buttons.length; i++) {
            if (buttons[i].getId() == "menu_mail" || buttons[i].getId() == "menu_mail_new") {
                buttons[i].setBadgeNumber(unreadMails);
            }
        }
        tutao.locator.notification.updateBadge(unreadMails);
    });
};



/************** implementation of tutao.tutanota.ctrl.bubbleinput.BubbleHandler **************/

/** @inheritDoc */
tutao.tutanota.ctrl.MailListViewModel.prototype.getSuggestions = function(text, callback) {
	callback([]);
};

/** @inheritDoc */
tutao.tutanota.ctrl.MailListViewModel.prototype.createBubbleFromSuggestion = function(suggestion) {
	return null;
};

/** @inheritDoc */
tutao.tutanota.ctrl.MailListViewModel.prototype.createBubblesFromText = function(text) {
	return [new tutao.tutanota.ctrl.bubbleinput.Bubble(null, ko.observable(text), ko.observable(null), ko.observable('default'), false)];
};

/** @inheritDoc */
tutao.tutanota.ctrl.MailListViewModel.prototype.bubbleDeleted = function(bubble) {
	// nothing to do
};

/** @inheritDoc */
tutao.tutanota.ctrl.MailListViewModel.prototype.buttonClick = function() {
    if ( this.buttonCss() == 'search'){
        this.hideSearchBar();
    }else {
        this.bubbleInputViewModel.bubbles.removeAll();
        this.bubbleInputViewModel.inputValue("");
        //this.search();
    }
};

tutao.tutanota.ctrl.MailListViewModel.prototype.buttonCss = function() {
    if (this.bubbleInputViewModel.inputValue().trim() || this.bubbleInputViewModel.bubbles().length > 0) {
        return 'cancel';
    } else {
        return 'search';
    }
};


