/*******************************************************************************
 * @license
 * Copyright (c) 2012 VMware, Inc. All Rights Reserved.
 * THIS FILE IS PROVIDED UNDER THE TERMS OF THE ECLIPSE PUBLIC LICENSE
 * ("AGREEMENT"). ANY USE, REPRODUCTION OR DISTRIBUTION OF THIS FILE
 * CONSTITUTES RECIPIENTS ACCEPTANCE OF THE AGREEMENT.
 * You can obtain a current copy of the Eclipse Public License from
 * http://www.opensource.org/licenses/eclipse-1.0.php
 *
 * Contributors:
 *     Andrew Eisenberg - initial API and implementation
 ******************************************************************************/

/*jslint browser:true */
/*global define */

if(!Array.isArray) {
  Array.isArray = function (vArg) {
    return Object.prototype.toString.call(vArg) === "[object Array]";
  };
}

/**
 * This module provides content assist gathered from .scripted-completion files
 */

define(['servlets/get-templates', 'when', 'scripted/exec/param-resolver', "plugins/esprima/proposalUtils"], function(getTemplates, when, resolver, proposalUtils) {

	/**
	 * shared templates
	 * @type {{completions:Array}}
	 */
	var allTemplates = {};

	function updatePosition(initialOffset, replaceStart, replacements) {
		var newOffset = initialOffset;
		for (var i = 0; i < replacements.length; i++) {
			if (replaceStart + replacements[i].start < initialOffset) {
				newOffset += replacements[i].lengthAdded;
			} else {
				break;
			}
		}
		return newOffset;
	}

	/**
	 * @param Number offset offset into unreplaced text
	 */
	function extractPositions(origPositions, replaceStart, replacements) {
		if (!origPositions) {
			return null;
		}
		var newPositions = [];
		if (Array.isArray(origPositions)) {
			origPositions.forEach(function(position) {
				newPositions.push(extractPositions(position, replaceStart, replacements));
			});
		} else {
			var offset = updatePosition(origPositions.offset + replaceStart, replaceStart, replacements);
			var length = updatePosition(origPositions.offset + origPositions.length+ replaceStart, replaceStart, replacements) - offset;
			newPositions = {
				offset : offset,
				length : length
			};
		}
		return newPositions;
	}



	function findPreviousChar(buffer, offset) {
		var c = "";
		while (offset >= 0) {
			c = buffer[offset];
			if (c === '\n' || c === '\r') {
				//we hit the start of the line so we are done
				break;
			} else if (/\s/.test(c)) {
				offset--;
			} else {
				// a non-whitespace character, we are done
				break;
			}
		}
		return c;
	}


	function TemplateContentAssist() { }

	TemplateContentAssist.prototype = {
		install : function(editor, scope, root) {
			if (editor) {
				this.replacer = resolver.forEditor(editor);
			} else {
				// a noop replacer
				this.replacer = {
					replaceParams : function(val) {
						return val;
					},
					findReplacements : function(val) {
						return [];
					}
				};
			}
			this.scope = scope;
			var deferred = when.defer();
			if (! allTemplates[scope]) {
				var templatesDeferred = getTemplates.loadRawTemplates(scope, root);
				templatesDeferred.then(function(templates) {
					allTemplates[scope] = templates;
					deferred.resolve(templates);
				}, function(err) {
					deferred.reject(err);
				});
			} else {
				deferred.resolve(allTemplates[scope]);
			}
			return deferred.promise;
		},
		computeProposals: function(buffer, invocationOffset, context) {
			var templatesOnly = context.selection && (context.selection.start !== context.selection.end);
			invocationOffset = context.selection ? Math.min(context.selection.start, context.selection.end) : invocationOffset;
			if (!allTemplates) {
				return [];
			}
			var myTemplates = allTemplates[this.scope];
			if (!myTemplates) {
				return [];
			}

			// assume we don't want templates if previous char is '.'
			if (findPreviousChar(buffer, invocationOffset) === '.') {
				return [];
			}

			// we're in business
			var newTemplates = [];
			var prefix = context.prefix;
			var replaceParams = this.replacer.replaceParams;
			var findReplacements = this.replacer.findReplacements;
			// find offset of the start of the word
			// for templates only, we don't care about word start, only what is selected
			var replaceStart = templatesOnly ? invocationOffset : invocationOffset - prefix.length;
			// we want to ignore opening < if the template starts with a <
			var implicitPrefix = buffer.charAt(replaceStart-1);
			myTemplates.forEach(function(template) {
				if ((templatesOnly && template.isTemplate) ||
					(!templatesOnly && proposalUtils.looselyMatches(prefix, template.trigger))) {

					// defer the actual calculation of the proposal until it is accepted
					var proposalFunc = function() {
						var implicitPrefixMatch = template.proposal.charAt(0) === implicitPrefix;
						var origText = implicitPrefixMatch ? template.proposal.substring(1) : template.proposal;
						var actualText = replaceParams(origText);
						var escape = template.escapePosition;
						var replacements = findReplacements(origText);
						if (escape) {
							if (implicitPrefixMatch) {
								escape--;
							}
							escape = updatePosition(escape + replaceStart, replaceStart, replacements);
						} else {
							escape = actualText.length + replaceStart;
						}
						replaceStart = implicitPrefixMatch ? replaceStart-1 : replaceStart;


						return {
							proposal : actualText,
							description : template.description,
							escapePosition : escape,
							positions : extractPositions(template.positions, replaceStart, replacements),
							// relevance not used...should it be?
	//						relevance : 20000,
							overwrite : true
						};
					};
					proposalFunc.description = template.description;
					newTemplates.push(proposalFunc);
				}
			});
			return newTemplates;
		}
	};

	return {
		TemplateContentAssist : TemplateContentAssist,
		_getAllTemplates : function() { return allTemplates; },
		_reset : function() {
			allTemplates = {};
			getTemplates._reset();
		}
	};
});