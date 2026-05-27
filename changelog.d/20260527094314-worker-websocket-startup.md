Fix HTTP worker startup so websocket broadcasts are not delivered to worker threads before their app configuration has finished initializing.
