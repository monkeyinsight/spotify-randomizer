const http = require("http");
const url = require('url');
const config = require('./config.json');
const SpotifyWebApi = require("spotify-web-api-node");
const spotify = new SpotifyWebApi(config);
const fs = require('fs');
const Promise = require('bluebird');
var token;

function getRandom(arr, n) {
    var result = new Array(n),
        len = arr.length,
        taken = new Array(len);
    if (n > len)
        throw new RangeError("getRandom: more elements taken than available");
    while (n--) {
        var x = Math.floor(Math.random() * len);
        result[n] = arr[x in taken ? taken[x] : x];
        taken[x] = --len in taken ? taken[len] : len;
    }
    return result;
}

http.createServer(function(req, res) {
    var query = url.parse(req.url,true).query;
    switch (true) {
        case /^\/login/.test(req.url):
            res.writeHead(302, {Location: spotify.createAuthorizeURL(['user-read-private', 'user-read-email'], 'test')});
            res.end();
            break;
        case /^\/callback/.test(req.url):
            token = query.code;
            spotify.authorizationCodeGrant(token).then(function (data) {
                spotify.setAccessToken(data.body['access_token']);
                spotify.setRefreshToken(data.body['refresh_token']);
                res.writeHead(200, {"Content-Type": "text/html"});
                res.write("<html><body>Authorized<br><a href='/playlist'>Playlist</a></body></html>");
                res.end();
            }, function (err) {
                console.error(err);
                res.end();
            });
            break;
        case /^\/random/.test(req.url):
            fs.readFile(__dirname + '/tracks.json', function (err, json) {
                let data = JSON.parse(json);
                let track = data[Math.floor(Math.random() * data.length)];
                res.writeHead(200, {"Content-Type": "text/html"});
                res.write('spotify:track:' + track);
                res.end();
            });
            break;
        case /^\/playlist/.test(req.url):
            fs.readFile(__dirname + '/tracks.json', function (err, json) {
                let data = JSON.parse(json);
                let rand = getRandom(data, query&&query.amount?query.amount:50);
                res.writeHead(200, {"Content-Type": "text/html"});
                for (var i in rand) {
                    res.write('spotify:track:' + rand[i] + '<br>');
                }
                res.end();
            });
            break;
        case /^\/parse\/(.+?)$/.test(req.url):
            let params = {limit: 50};
            var query = [];

            var matches = req.url.match(/^\/parse\/(.+?)$/);
            if (matches && matches[1]) {
                if (/country/.test(matches[1])) {
                    params.country = matches[1].split(':')[1];

                    query.push(spotify.getCategories(params).then(function (data) {
                        return data.body.categories.items.map(function (category) {
                            return category.id
                        });
                    }).then(function (categories) {
                        console.log('Getting categories...');
                        //categories = categories.slice(0,1);
                        let promises = [];
                        for (var i in categories) {
                            promises.push(
                                new Promise(function (resolve, reject) {
                                    spotify.getPlaylistsForCategory(categories[i], {
                                        limit: 50
                                    }).then(function (data) {
                                        return resolve(data);
                                    }, function (err) {
                                        return resolve(categories[i], err);
                                    });
                                })
                            );
                        }
        
                        return new Promise(function (resolve) {
                            Promise.all(promises).then(function (data) {
                                console.log('Got ' + data.length + ' categories.');
                                return resolve(data.map(function (category) {
                                    if (!category || !category.body) return;
                                    return category.body.playlists.items.map(function (playlist) {
                                        return playlist.id;
                                    });
                                }));
                            });
                        });
                    }));
                    params.country = matches[1];
                } else if (/playlist/.test(matches[1])) {
                    query.push(spotify.searchPlaylists(matches[1].split(':')[1]).then(function (data) {
                        return data.body.playlists.items.map(function (playlist) {
                            return playlist.id;
                        })
                    }));
                }
            }
            var tracks = [];
            new Promise.all(query).then(function (playlists) {
                playlists = playlists.flat(2);
                console.log('Reading ' + playlists.length + ' playlists...');
                //playlists = playlists.slice(0,5);
                let counter = 0;

                Promise.map(playlists, function (playlist) {
                    return new Promise(function (resolve) {
                        counter++;
                        console.log('Reading ' + counter + ' of ' + playlists.length + '...');
                        setTimeout(function () {
                            return spotify.getPlaylist(playlist, {
                                limit: 100
                            }).then(function (data) {
                                if (data && data.body) {
                                    tracks.push(
                                        data.body.tracks.items.map(function (track) {
                                            if (!track || !track.track) return;
                                            return track.track.id
                                        })
                                    );
                                    resolve();
                                }
                            }).catch(function (err) {
                                console.error(err);
                                resolve();
                            });
                        }, 500);
                    });
                }, {concurrency: 1}).then(function () {
                    tracks = tracks.flat(1);
                    console.log('Got ' + tracks.length + ' tracks.');
                    tracks = tracks.concat(require('./tracks.json'));
                    let arr = Array.from(new Set(tracks));
                    fs.writeFile('tracks.json', JSON.stringify(arr), 'utf8', function () {
                        console.log('Finished.');
                    });
                })
            }).catch(function (err) {
                console.error(err);
            });
            res.end(); 
            break;
        default:
            res.writeHead(200, {"Content-Type": "text/html"});
            res.write("<html><body>Hello World<br><a href='/login'>Authorize</a></body></html>");
            res.end();
            break;
    }
}).listen(config.port);