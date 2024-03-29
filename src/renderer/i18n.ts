import log from 'electron-log';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_OPTIONS } from '../common/i18n';

i18n.use(initReactI18next)
    .init(DEFAULT_OPTIONS)
    .catch((err) => {
        log.error(err);
    });
