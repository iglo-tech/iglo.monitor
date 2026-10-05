// @ts-nocheck

import NotificationProvider from "@/server/notification-providers/notification-provider";
import httpClient from "@/server/http-client";

const defaultNotificationService = "notify";

class HomeAssistant extends NotificationProvider {
    name = "HomeAssistant";

    /**
     * @inheritdoc
     */
    async send(notification, msg, monitorJSON = null, heartbeatJSON = null) {
        const okMsg = "Sent Successfully.";

        const notificationService = notification?.notificationService || defaultNotificationService;

        try {
            let config = {
                headers: {
                    Authorization: `Bearer ${notification.longLivedAccessToken}`,
                    "Content-Type": "application/json",
                },
            };
            config = this.getAxiosConfigWithProxy(config);
            await httpClient.post(
                `${notification.homeAssistantUrl.trim().replace(/\/*$/, "")}/api/services/notify/${notificationService}`,
                {
                    title: "iglo.monitor",
                    message: msg,
                    ...(notificationService !== "persistent_notification" && {
                        data: {
                            name: monitorJSON?.name,
                            status: heartbeatJSON?.status,
                            channel: "iglo.monitor",
                            icon_url: "https://raw.githubusercontent.com/iglo-tech/iglo.monitor/main/public/icon.png",
                        },
                    }),
                },
                config
            );

            return okMsg;
        } catch (error) {
            this.throwGeneralAxiosError(error);
        }
    }
}

export default HomeAssistant;
