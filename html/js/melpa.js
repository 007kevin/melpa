/* global window */
(function(angular, _, moment){
  "use strict";

  // TODO Disqus
  // TODO Show compatible emacs versions for any package
  // TODO Google Analytics http://stackoverflow.com/questions/10713708/tracking-google-analytics-page-views-with-angular-js
  // TODO D3 visualisation for deps

  var app = angular.module('melpa', []);

  //////////////////////////////////////////////////////////////////////////////
  // SERVICES
  //////////////////////////////////////////////////////////////////////////////

  app.factory('packageService', function($http, $q) {
    var packages = $q.all({archive: $http.get("/archive.json"),
                           recipes: $http.get("/recipes.json"),
                           downloads: $http.get("/download_counts.json") // TODO: handle missing
                          })
          .then(function (info) {

            var calculateSourceURL = function(name, recipe)  {
              if (recipe.fetcher == "github") {
                return (/\//.test(recipe.repo) ? "https://github.com/" : "https://gist.github.com/") + recipe.repo;
              } else if (recipe.fetcher == "wiki" && !recipe.files) {
                return "http://www.emacswiki.org/emacs/" + name + ".el";
              } else if (recipe.url) {
                var urlMatch = function(re, prefix) {
                  var m = recipe.url.match(re);
                  return m !== null ? prefix + m[0] : null;
                };
                return urlMatch(/(bitbucket\.org\/[^\/]+\/[^\/\?]+)/, "https://") ||
                  urlMatch(/(gitorious\.org\/[^\/]+\/[^.]+)/, "https://") ||
                  urlMatch(/\Alp:(.*)/, "https://launchpad.net/") ||
                  urlMatch(/\A(https?:\/\/code\.google\.com\/p\/[^\/]+\/)/) ||
                  urlMatch(/\A(https?:\/\/[^.]+\.googlecode\.com\/)/);
              }
              return null;
            };

            var listed = _.intersection(_(info.archive.data).keys(), _(info.recipes.data).keys());
            return _(listed).reduce(function(pkgs, name) {
              var built = info.archive.data[name];
              var recipe = info.recipes.data[name];
              var descr = built[2].replace(/\s*\[((?:source: )?\w+)\]$/, "");
              var version = built[0].join(".");
              // Fix up hokey deps, which look like {"clojure-mode":{"2":[0,0]}} for 2.0.0
              var deps = _(built[1] || {}).map(function (val, name) {
                var v1 = _.keys(val)[0];
                return {name: name, version: [v1].concat(val[v1] || []).join('.')};
              });
              pkgs[name] = {
                name: name,
                version: version,
                dependencies: deps,
                description: descr,
                source: recipe.fetcher,
                downloads: info.downloads.data[name] || 0,
                fetcher: recipe.fetcher,
                recipeURL: "https://github.com/milkypostman/melpa/blob/master/recipes/" + name,
                packageURL: "packages/" + name + "-" + version + "." + (built[3] == "single" ? "el" : "tar"),
                sourceURL: calculateSourceURL(name, recipe)
              };
              return pkgs;
            }, {});
          });
    var buildStatus = $http.get("/build-status.json").then(function(r) { return r.data; });

    return {
      getPackages: function() {
        return packages;
      },

      dependenciesOn: function(name) {
        return packages.then(function(pkgs) {
          return _(pkgs).values().filter(function(p) {
            return _(p.dependencies).findWhere({name: name});
          });
        });
      },

      buildStatus: function() {
        return buildStatus;
      }
    };
  });


  //////////////////////////////////////////////////////////////////////////////
  // Controllers
  //////////////////////////////////////////////////////////////////////////////

  app.controller('PackageListCtrl', function ($scope, $routeParams, packageService) {
    $scope.orderBy = "name";
    $scope.searchTerms = $routeParams.q;
    packageService.getPackages().then(function(pkgs){
      $scope.packages = _(pkgs).values();
      $scope.totalDownloads = _.reduce(_($scope.packages).pluck("downloads"), function (a, b) { return b === undefined ? a : a + b; }, 0);
    });
    $scope.packageMatcher = function(term) {
      var t = term && term.toLowerCase();
      var matchp = function(v) {
        return v && v.toLowerCase().indexOf(t) != -1;
      };
      return function(pkg) {
        if (!term || !term.match(/\S/)) return true;
        return matchp(pkg.name) || matchp(pkg.description) || matchp(pkg.source) || matchp(pkg.version) || matchp(pkg.sourceURL);
      };
    };
  });

  var detailsCtrl = app.controller('PackageDetailsCtrl', function ($scope, $routeParams, $http, packageService) {
    var packageName =  $routeParams.packageName;
    packageService.getPackages().then(function(pkgs) {
      $scope.allPackages = pkgs;
      $scope.pkg = pkgs[packageName];
      $scope.reverseDependencies = packageService.dependenciesOn(packageName);
    });
    $scope.readme = $http.get("/packages/" + packageName + "-readme.txt").then(function(r) { return r.data; });
    $scope.havePackage = function(pkgName) {
      return $scope.allPackages[pkgName];
    };
  });
  detailsCtrl.resolve = {
    // Fail to resolve unless this particular package exists
    pkgs: function (packageService, $route, $q) {
      var deferred = $q.defer();
      packageService.getPackages().then(function(pkgs) {
        if (pkgs[$route.current.params.packageName])
          deferred.resolve(pkgs);
        else
          deferred.reject("No such package");
      });
      return deferred.promise;
    }
  };

  app.controller('BuildStatusCtrl', function($scope, packageService) {
    $scope.buildStatus = packageService.buildStatus();
  });

  app.controller('AppCtrl', function($scope, $rootScope, $route) {
    $scope.showSplash = true;
    $rootScope.$on("$routeChangeSuccess", function() {
      $scope.showSplash = ($route.current.controller == 'PackageListCtrl');
    });
  });

  //////////////////////////////////////////////////////////////////////////////
  // Directives
  //////////////////////////////////////////////////////////////////////////////

  app.directive("viewOrError", function($rootScope) {
    return {
      template: '<div>' +
        '<div class="alert alert-danger" ng-if="routeError"><strong>Error: </strong>{{routeError}}</div>' +
        '<div ng-if="!routeError" ng-view><ng-transclude></ng-transclude></div>'+'</div>',
      transclude: true,
      link: function(scope) {
        $rootScope.$on("$routeChangeError", function (event, current, previous, rejection) {
          scope.routeError = rejection;
        });
        $rootScope.$on("$routeChangeSuccess", function () {
          scope.routeError = null;
        });
      }
    };
  });

  app.directive("sortIndicator", function() {
    return {
      scope: { sortIndicator: "@" },
      replace: true,
      template: '<span ng-class="classname"></span>',
      link: function(scope) {
        scope.$watch('sortIndicator', function() {
          scope.classname = 'table-sort-indicator glyphicon ' +
            ({'asc': 'glyphicon-chevron-down',
              'desc': 'glyphicon-chevron-up' }[scope.sortIndicator] ||
             'glyphicon-minus');
        });
      }
    };
  });

  app.directive("tableSort", function() {
    return {
      scope: {
        tableSort: "=",
        sortField: "@"
      },
      transclude: true,
      template: '<div class="table-sort"><span sort-indicator="{{order}}"></span><div ng-transclude></div></div>',
      link: function(scope, element) {
        var sortingAsc = function() {
          return _([scope.sortField, "+" + scope.sortField]).contains(scope.tableSort);
        };
        var sortingDesc = function() {
          return scope.tableSort == "-" + scope.sortField;
        };
        element.bind('click', function() {
          scope.$apply(function() {
            scope.tableSort = sortingAsc() ? "-" + scope.sortField : scope.sortField;
          });
        });
        scope.$watch('tableSort', function() {
          scope.order = (function() {
              if (sortingAsc()) return 'asc';
              if (sortingDesc()) return 'desc';
              return '';
          })();
        });
      }
    };
  });

  //////////////////////////////////////////////////////////////////////////////
  // Filters
  //////////////////////////////////////////////////////////////////////////////
  app.filter('relativeTime', function() {
    return function(val) {
      return val && moment(new Date(val)).fromNow();
    };
  });

  //////////////////////////////////////////////////////////////////////////////
  // Routes
  //////////////////////////////////////////////////////////////////////////////
  app.config(['$locationProvider', function($locationProvider){
    $locationProvider.html5Mode(false);
  }]);
  app.config(['$routeProvider', function($routeProvider){
    $routeProvider
      .when('/', {templateUrl: 'partials/list.html', controller: 'PackageListCtrl', splash: true})
      .when('/getting-started', {templateUrl: 'partials/getting-started.html'})
      .when('/:packageName', {templateUrl: 'partials/package.html', controller: 'PackageDetailsCtrl', resolve: detailsCtrl.resolve});
  }]);

})(window.angular, window._, window.moment);
