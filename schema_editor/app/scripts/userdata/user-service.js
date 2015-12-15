(function() {
    'use strict';

    /**
     * @ngInject
     */
    function UserService ($resource, $q, ASEConfig) {

        var tmpToken = '';

        var User = $resource(ASEConfig.api.hostname + '/api/users/:id/', {id: '@id'}, {
            'delete': {
                method: 'DELETE',
                url: ASEConfig.api.hostname + '/api/users/:id/'
            },
            'update': {
                method: 'PATCH',
                url: ASEConfig.api.hostname + '/api/users/:id/'
            },
            'changePassword' : {
                method: 'POST',
                url: ASEConfig.api.hostname + '/api/users/:id/change_password/'
            },
            'resetPassword' : {
                method: 'POST',
                url: ASEConfig.api.hostname + '/api/users/:id/reset_password/'
            },
            'query': {
                method: 'GET',
                headers: {
                    'Authorization': function() {
                        // use a temporarily set token if we have one
                        if (tmpToken) {
                            return 'Token ' + tmpToken;
                        }
                        return null;
                    }
                }
            }
        }, {
            cache: true,
            stripTrailingSlashes: false
        });

        var module = {
            User: User,
            canWriteRecords: canWriteRecords,
            getUser: getUser,
            isAdmin: isAdmin
        };
        return module;

        function getUser(userId) {
            var dfd = $q.defer();
            module.User.get({id: userId}, function (user) {
                // append attribute to response to indicate if user is an admin or not
                user.isAdmin = userBelongsToAdmin(user);
                dfd.resolve(user);
            });
            return dfd.promise;
        }

        // Check whether user has write access
        function canWriteRecords(userId, token) {
            tmpToken = token;
            var dfd = $q.defer();
            module.User.query({id: userId}, function (user) {
                if (user && user.groups) {
                    // admin or analyst can write records
                    if (userBelongsToAdmin(user) ||
                        user.groups.indexOf(ASEConfig.api.groups.readWrite) > -1) {

                        dfd.resolve(true);
                    } else {
                        dfd.resolve(false);
                    }
                } else {
                    dfd.resolve(false);
                }
                tmpToken = '';
            });

            return dfd.promise;
        }

        // Check whether user is an admin or not before logging them in (for the editor)
        function isAdmin(userId, token) {
            tmpToken = token;
            var dfd = $q.defer();
            module.User.query({id: userId}, function (user) {
                if (userBelongsToAdmin(user)) {
                    dfd.resolve(true);
                } else {
                    dfd.resolve(false);
                }
                tmpToken = '';
            });

            return dfd.promise;
        }

        // hepler to check for admin group membership
        function userBelongsToAdmin(user) {
            if (user && user.groups && user.groups.indexOf(ASEConfig.api.groups.admin) > -1) {
                return true;
            } else {
                return false;
            }
        }
    }

    angular.module('ase.userdata').factory('UserService', UserService);

})();

