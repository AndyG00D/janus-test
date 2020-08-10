var server = [
    "https://" + window.location.hostname + "/rtc",
    "https://janus-test.ga/rtc",
    "ws://" + '46.101.168.8' + ":8188",
    "wss://" + '46.101.168.8' + ":8189",
    "/janus"
];
//     [
//     // "ws://" + window.location.hostname + ":8188",
//
//     "ws://janus.conf.meetecho.com/ws",
//     // "ws://" + '46.101.168.8' + ":8188",
//     "/janus"
// ];
// if (window.location.protocol === 'http:')
//     server = "http://" + '46.101.168.8' + ":8088/janus";
// else
//     server = "https://" + '46.101.168.8' + ":8089/janus";

var janus = null;
var sfutest = null;
var opaqueId = "videoroomtest-" + Janus.randomString(12);

var started = false;

var myroom = null;	// Demo room
var myusername = null;
var myid = null;
var mystream = null;
let roomList = [];
// We use this other ID just to map our subscriptions to us
// var mypvtid = null;

var feeds = [];
var bitrateTimer = [];
var remoteFeed = null;

var doSimulcast = (getQueryStringValue("simulcast") === "yes" || getQueryStringValue("simulcast") === "true");

$(document).ready(function () {
    // Initialize the library (all console debuggers enabled)
    Janus.init({
        debug: "all", callback: function () {
            // Use a button to start the demo
            // $('#start').click(function() {
            // 	if(started)
            // 		return;
            // 	started = true;
            // 	$(this).attr('disabled', true).unbind('click');
            // Make sure the browser supports WebRTC
            if (!Janus.isWebrtcSupported()) {
                bootbox.alert("No WebRTC support... ");
                return;
            }
            // Create session
            janus = new Janus(
                {
                    server: server,
                    success: function () {
                        getList();

                    },
                    error: function (error) {
                        Janus.error(error);
                        bootbox.alert(error, function () {
                            window.location.reload();
                        });
                    },
                    destroyed: function () {
                        window.location.reload();
                    }
                });
            // });
        }
    });
});

function prepareChoseRoomList() {
    const roomlistBlock = $('#room_list');
    let radioList = '<legend>Choose room: </legend>';
    roomList.forEach((room, index) => {
        radioList += `
                               <div class="form-check">
                                    <input class="form-check-input" type="radio" name="chosen_room" id="radio_room_${index}" value="${index}">
                                     <label class="form-check-label" for="radio_room_${index}">
                                        room: ${room.room} description: ${room.description}
                                     </label>
                               </div>
                               `;
    });
    radioList += ` 
                                   <span class="input-group-btn">
                                        <button class="btn btn-success" autocomplete="off" id="register" onclick="joinRoom()">Join the room</button>
                                   </span>
                            `;
    roomlistBlock.html(radioList).removeClass('hide');
}

function getList() {
    // A new feed has been published, create a new plugin handle and attach to it as a listener
    // $('#videocontainer').removeClass('hide');
    janus.attach(
        {
            plugin: "janus.plugin.videoroom",
            opaqueId: opaqueId,
            success: function (pluginHandle) {

                remoteFeed = pluginHandle;
                // remoteFeed.simulcastStarted = false;
                Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
                Janus.log("  -- This is a subscriber");
                var list = {
                    "request": "list",
                };
                remoteFeed.send({
                    message: list,
                    success: function (result) {
                        if (!('list' in result && result.list.length > 0)) {
                            bootbox.alert("No available rooms");
                            return;
                        }

                        roomList = result.list;
                        const roomName = +getQueryStringValue("room");
                        if (roomName) {
                            const queryRoom = roomList.find(room => room.room === roomName);
                            if (queryRoom) {
                                getPublisher(queryRoom);
                                return;
                            } else {
                                bootbox.alert("Wrong link! The room is absent in available rooms");
                            }
                        }
                        prepareChoseRoomList();
                    }
                });
            },
            error: function (error) {
                Janus.error("  -- Error attaching plugin...", error);
                bootbox.alert("Error attaching plugin... " + error);
            },
            onmessage: function (msg, jsep) {
                Janus.debug(" ::: Got a message (listener) :::");
                Janus.debug(msg);
                var event = msg["videoroom"];
                Janus.debug("Event: " + event);
                if (msg["error"] !== undefined && msg["error"] !== null) {
                    bootbox.alert(msg["error"]);
                } else if (event != undefined && event != null) {
                    if (event === "attached") {
                        // Subscriber created and attached
                        for (var i = 1; i < 6; i++) {
                            if (feeds[i] === undefined || feeds[i] === null) {
                                feeds[i] = remoteFeed;
                                remoteFeed.rfindex = i;
                                break;
                            }
                        }
                        remoteFeed.rfid = msg["id"];
                        remoteFeed.rfdisplay = msg["display"];
                        if (remoteFeed.spinner === undefined || remoteFeed.spinner === null) {
                            var target = document.getElementById('videoremote' + remoteFeed.rfindex);
                            remoteFeed.spinner = new Spinner({top: 100}).spin(target);
                        } else {
                            remoteFeed.spinner.spin();
                        }
                        Janus.log("Successfully attached to feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") in room " + msg["room"]);
                        $('#remote' + remoteFeed.rfindex).removeClass('hide').html(remoteFeed.rfdisplay).show();
                    } else if (event === "event") {
                        // Check if we got an event on a simulcast-related event from this publisher
                        var substream = msg["substream"];
                        var temporal = msg["temporal"];
                        if ((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
                            if (!remoteFeed.simulcastStarted) {
                                remoteFeed.simulcastStarted = true;
                                // Add some new buttons
                                addSimulcastButtons(remoteFeed.rfindex);
                            }
                            // We just received notice that there's been a switch, update the buttons
                            updateSimulcastButtons(remoteFeed.rfindex, substream, temporal);
                        }
                    } else {
                        // What has just happened?
                    }
                }
                if (jsep !== undefined && jsep !== null) {
                    Janus.debug("Handling SDP as well...");
                    Janus.debug(jsep);
                    // Answer and attach
                    remoteFeed.createAnswer(
                        {
                            jsep: jsep,
                            // Add data:true here if you want to subscribe to datachannels as well
                            // (obviously only works if the publisher offered them in the first place)
                            media: {audioSend: false, videoSend: false},	// We want recvonly audio/video
                            success: function (jsep) {
                                Janus.debug("Got SDP!");
                                Janus.debug(jsep);
                                var body = {"request": "start", "room": myroom};
                                remoteFeed.send({"message": body, "jsep": jsep});
                            },
                            error: function (error) {
                                Janus.error("WebRTC error:", error);
                                bootbox.alert("WebRTC error... " + JSON.stringify(error));
                            }
                        });
                }
            },
            webrtcState: function (on) {
                Janus.log("Janus says this WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") is " + (on ? "up" : "down") + " now");
            },
            onlocalstream: function (stream) {

                // The subscriber stream is recvonly, we don't expect anything here
            },
            onremotestream: function (stream) {
                debugger

                Janus.debug("Remote feed #" + remoteFeed.rfindex);
                var addButtons = false;
                if ($('#remotevideo' + remoteFeed.rfindex).length === 0) {
                    addButtons = true;
                    // No remote video yet
                    $('#videoremote' + remoteFeed.rfindex).append('<video class="rounded centered" id="waitingvideo' + remoteFeed.rfindex + '" width=320 height=240 />');
                    $('#videoremote' + remoteFeed.rfindex).append('<video class="rounded centered relative hide" id="remotevideo' + remoteFeed.rfindex + '" width="100%" height="100%" autoplay/>');
                    $('#videoremote' + remoteFeed.rfindex).append(
                        '<span class="label label-primary hide" id="curres' + remoteFeed.rfindex + '" style="position: absolute; bottom: 0px; left: 0px; margin: 15px;"></span>' +
                        '<span class="label label-info hide" id="curbitrate' + remoteFeed.rfindex + '" style="position: absolute; bottom: 0px; right: 0px; margin: 15px;"></span>');
                    // Show the video, hide the spinner and show the resolution when we get a playing event
                    $("#remotevideo" + remoteFeed.rfindex).bind("playing", function () {
                        if (remoteFeed.spinner !== undefined && remoteFeed.spinner !== null)
                            remoteFeed.spinner.stop();
                        remoteFeed.spinner = null;
                        $('#waitingvideo' + remoteFeed.rfindex).remove();
                        if (this.videoWidth)
                            $('#remotevideo' + remoteFeed.rfindex).removeClass('hide').show();
                        var width = this.videoWidth;
                        var height = this.videoHeight;
                        $('#curres' + remoteFeed.rfindex).removeClass('hide').text(width + 'x' + height).show();
                        if (Janus.webRTCAdapter.browserDetails.browser === "firefox") {
                            // Firefox Stable has a bug: width and height are not immediately available after a playing
                            setTimeout(function () {
                                var width = $("#remotevideo" + remoteFeed.rfindex).get(0).videoWidth;
                                var height = $("#remotevideo" + remoteFeed.rfindex).get(0).videoHeight;
                                $('#curres' + remoteFeed.rfindex).removeClass('hide').text(width + 'x' + height).show();
                            }, 2000);
                        }
                    });
                }
                Janus.attachMediaStream($('#remotevideo' + remoteFeed.rfindex).get(0), stream);
                var videoTracks = stream.getVideoTracks();
                if (videoTracks === null || videoTracks === undefined || videoTracks.length === 0 || videoTracks[0].muted) {
                    // No remote video
                    $('#remotevideo' + remoteFeed.rfindex).hide();
                    if ($('#remotevideo' + remoteFeed.rfindex + ' .no-video-container').length === 0) {
                        $('#remotevideo' + remoteFeed.rfindex).append(
                            '<div class="no-video-container">' +
                            '<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
                            '<span class="no-video-text">No remote video available</span>' +
                            '</div>');
                    }
                } else {
                    $('#remotevideo' + remoteFeed.rfindex + ' .no-video-container').remove();
                    $('#remotevideo' + remoteFeed.rfindex).removeClass('hide').show();
                }
                if (!addButtons)
                    return;
                if (Janus.webRTCAdapter.browserDetails.browser === "chrome" || Janus.webRTCAdapter.browserDetails.browser === "firefox" ||
                    Janus.webRTCAdapter.browserDetails.browser === "safari") {
                    $('#curbitrate' + remoteFeed.rfindex).removeClass('hide').show();
                    bitrateTimer[remoteFeed.rfindex] = setInterval(function () {
                        // Display updated bitrate, if supported
                        var bitrate = remoteFeed.getBitrate();
                        $('#curbitrate' + remoteFeed.rfindex).text(bitrate);
                        // Check if the resolution changed too
                        var width = $("#remotevideo" + remoteFeed.rfindex).get(0).videoWidth;
                        var height = $("#remotevideo" + remoteFeed.rfindex).get(0).videoHeight;
                        if (width > 0 && height > 0)
                            $('#curres' + remoteFeed.rfindex).removeClass('hide').text(width + 'x' + height).show();
                    }, 1000);
                }
            },
            oncleanup: function () {

                Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
                if (remoteFeed.spinner !== undefined && remoteFeed.spinner !== null)
                    remoteFeed.spinner.stop();
                remoteFeed.spinner = null;
                $('#remotevideo' + remoteFeed.rfindex).remove();
                $('#waitingvideo' + remoteFeed.rfindex).remove();
                $('#novideo' + remoteFeed.rfindex).remove();
                $('#curbitrate' + remoteFeed.rfindex).remove();
                $('#curres' + remoteFeed.rfindex).remove();
                if (bitrateTimer[remoteFeed.rfindex] !== null && bitrateTimer[remoteFeed.rfindex] !== null)
                    clearInterval(bitrateTimer[remoteFeed.rfindex]);
                bitrateTimer[remoteFeed.rfindex] = null;
                remoteFeed.simulcastStarted = false;
                $('#simulcast' + remoteFeed.rfindex).remove();
            }
        });
}

function newRemoteFeed(id, display, audio, video) {
    debugger
    // A new feed has been published, create a new plugin handle and attach to it as a listener
    // $('#videocontainer').removeClass('hide');

    // remoteFeed = pluginHandle;
    // remoteFeed.simulcastStarted = false;
    Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
    Janus.log("  -- This is a subscriber");
    // We wait for the plugin to send us an offer

    var listen = {
        "request": "join",
        "room": myroom,
        "ptype": "listener",
        "feed": +id,
        // "private_id": +mypvtid
    };
    // In case you don't want to receive audio, video or data, even if the
    // publisher is sending them, set the 'offer_audio', 'offer_video' or
    // 'offer_data' properties to false (they're true by default), e.g.:
    // 		listen["offer_video"] = false;
    // For example, if the publisher is VP8 and this is Safari, let's avoid video
    if (video !== "h264" && Janus.webRTCAdapter.browserDetails.browser === "safari") {
        if (video)
            video = video.toUpperCase();
        toastr.warning("Publisher is using " + video + ", but Safari doesn't support it: disabling video");
        listen["offer_video"] = false;
    }
    remoteFeed.send({"message": listen});
    $('#videocontainer').removeClass('hide');
}

// Helper to parse query string
function getQueryStringValue(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(location.search);
    return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

// Helpers to create Simulcast-related UI, if enabled
function addSimulcastButtons(feed) {
    var index = feed;
    $('#remote' + index).parent().append(
        '<div id="simulcast' + index + '" class="btn-group-vertical btn-group-vertical-xs pull-right">' +
        '	<div class"row">' +
        '		<div class="btn-group btn-group-xs" style="width: 100%">' +
        '			<button id="sl' + index + '-2" type="button" class="btn btn-primary" data-toggle="tooltip" title="Switch to higher quality" style="width: 33%">SL 2</button>' +
        '			<button id="sl' + index + '-1" type="button" class="btn btn-primary" data-toggle="tooltip" title="Switch to normal quality" style="width: 33%">SL 1</button>' +
        '			<button id="sl' + index + '-0" type="button" class="btn btn-primary" data-toggle="tooltip" title="Switch to lower quality" style="width: 34%">SL 0</button>' +
        '		</div>' +
        '	</div>' +
        '	<div class"row">' +
        '		<div class="btn-group btn-group-xs" style="width: 100%">' +
        '			<button id="tl' + index + '-2" type="button" class="btn btn-primary" data-toggle="tooltip" title="Cap to temporal layer 2" style="width: 34%">TL 2</button>' +
        '			<button id="tl' + index + '-1" type="button" class="btn btn-primary" data-toggle="tooltip" title="Cap to temporal layer 1" style="width: 33%">TL 1</button>' +
        '			<button id="tl' + index + '-0" type="button" class="btn btn-primary" data-toggle="tooltip" title="Cap to temporal layer 0" style="width: 33%">TL 0</button>' +
        '		</div>' +
        '	</div>' +
        '</div>'
    );
    // Enable the VP8 simulcast selection buttons
    $('#sl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary')
        .unbind('click').click(function () {
        toastr.info("Switching simulcast substream, wait for it... (lower quality)", null, {timeOut: 2000});
        if (!$('#sl' + index + '-2').hasClass('btn-success'))
            $('#sl' + index + '-2').removeClass('btn-primary btn-info').addClass('btn-primary');
        if (!$('#sl' + index + '-1').hasClass('btn-success'))
            $('#sl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-primary');
        $('#sl' + index + '-0').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
        feeds[index].send({message: {request: "configure", substream: 0}});
    });
    $('#sl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary')
        .unbind('click').click(function () {
        toastr.info("Switching simulcast substream, wait for it... (normal quality)", null, {timeOut: 2000});
        if (!$('#sl' + index + '-2').hasClass('btn-success'))
            $('#sl' + index + '-2').removeClass('btn-primary btn-info').addClass('btn-primary');
        $('#sl' + index + '-1').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
        if (!$('#sl' + index + '-0').hasClass('btn-success'))
            $('#sl' + index + '-0').removeClass('btn-primary btn-info').addClass('btn-primary');
        feeds[index].send({message: {request: "configure", substream: 1}});
    });
    $('#sl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary')
        .unbind('click').click(function () {
        toastr.info("Switching simulcast substream, wait for it... (higher quality)", null, {timeOut: 2000});
        $('#sl' + index + '-2').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
        if (!$('#sl' + index + '-1').hasClass('btn-success'))
            $('#sl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-primary');
        if (!$('#sl' + index + '-0').hasClass('btn-success'))
            $('#sl' + index + '-0').removeClass('btn-primary btn-info').addClass('btn-primary');
        feeds[index].send({message: {request: "configure", substream: 2}});
    });
    $('#tl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary')
        .unbind('click').click(function () {
        toastr.info("Capping simulcast temporal layer, wait for it... (lowest FPS)", null, {timeOut: 2000});
        if (!$('#tl' + index + '-2').hasClass('btn-success'))
            $('#tl' + index + '-2').removeClass('btn-primary btn-info').addClass('btn-primary');
        if (!$('#tl' + index + '-1').hasClass('btn-success'))
            $('#tl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-primary');
        $('#tl' + index + '-0').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
        feeds[index].send({message: {request: "configure", temporal: 0}});
    });
    $('#tl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary')
        .unbind('click').click(function () {
        toastr.info("Capping simulcast temporal layer, wait for it... (medium FPS)", null, {timeOut: 2000});
        if (!$('#tl' + index + '-2').hasClass('btn-success'))
            $('#tl' + index + '-2').removeClass('btn-primary btn-info').addClass('btn-primary');
        $('#tl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-info');
        if (!$('#tl' + index + '-0').hasClass('btn-success'))
            $('#tl' + index + '-0').removeClass('btn-primary btn-info').addClass('btn-primary');
        feeds[index].send({message: {request: "configure", temporal: 1}});
    });
    $('#tl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary')
        .unbind('click').click(function () {
        toastr.info("Capping simulcast temporal layer, wait for it... (highest FPS)", null, {timeOut: 2000});
        $('#tl' + index + '-2').removeClass('btn-primary btn-info btn-success').addClass('btn-info');
        if (!$('#tl' + index + '-1').hasClass('btn-success'))
            $('#tl' + index + '-1').removeClass('btn-primary btn-info').addClass('btn-primary');
        if (!$('#tl' + index + '-0').hasClass('btn-success'))
            $('#tl' + index + '-0').removeClass('btn-primary btn-info').addClass('btn-primary');
        feeds[index].send({message: {request: "configure", temporal: 2}});
    });
}

function updateSimulcastButtons(feed, substream, temporal) {
    // Check the substream
    var index = feed;
    if (substream === 0) {
        toastr.success("Switched simulcast substream! (lower quality)", null, {timeOut: 2000});
        $('#sl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary');
        $('#sl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary');
        $('#sl' + index + '-0').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
    } else if (substream === 1) {
        toastr.success("Switched simulcast substream! (normal quality)", null, {timeOut: 2000});
        $('#sl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary');
        $('#sl' + index + '-1').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
        $('#sl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary');
    } else if (substream === 2) {
        toastr.success("Switched simulcast substream! (higher quality)", null, {timeOut: 2000});
        $('#sl' + index + '-2').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
        $('#sl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary');
        $('#sl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary');
    }
    // Check the temporal layer
    if (temporal === 0) {
        toastr.success("Capped simulcast temporal layer! (lowest FPS)", null, {timeOut: 2000});
        $('#tl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary');
        $('#tl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary');
        $('#tl' + index + '-0').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
    } else if (temporal === 1) {
        toastr.success("Capped simulcast temporal layer! (medium FPS)", null, {timeOut: 2000});
        $('#tl' + index + '-2').removeClass('btn-primary btn-success').addClass('btn-primary');
        $('#tl' + index + '-1').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
        $('#tl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary');
    } else if (temporal === 2) {
        toastr.success("Capped simulcast temporal layer! (highest FPS)", null, {timeOut: 2000});
        $('#tl' + index + '-2').removeClass('btn-primary btn-info btn-success').addClass('btn-success');
        $('#tl' + index + '-1').removeClass('btn-primary btn-success').addClass('btn-primary');
        $('#tl' + index + '-0').removeClass('btn-primary btn-success').addClass('btn-primary');
    }
}

function getPublisher(room) {

    myroom = +room.room;
    var body = {
        "request": "listparticipants",
        "room": myroom
    };
    remoteFeed.send({
        message: body,
        success: function (result) {

            const publisher = 'participants' in result ? result.participants[0] : null;
            if (!publisher) {
                bootbox.alert("No publishers in room!");
                return;
            }
            newRemoteFeed(publisher.id, publisher.display, room.audiocodec, room.videocodec)
        }
    });
}

function joinRoom() {

    const roomIndex = $('input[name=chosen_room]:checked').val();
    if (roomIndex === undefined) {
        bootbox.alert("Please, choose room!");
        return;
    }
    $('#room_list').addClass('hide');
    // bootbox.alert("room: " + roomIndex);
    getPublisher(roomList[roomIndex]);
}
