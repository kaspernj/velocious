Prevent queued background-job mutations from checking out database connections before process-local serializer admission, avoiding jobs-main pool starvation during mutation bursts.
