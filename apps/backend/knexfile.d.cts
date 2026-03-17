export namespace development {
    let client: string;
    namespace connection {
        let host: string | undefined;
        let port: number;
        let user: string | undefined;
        let password: string | undefined;
        let database: string | undefined;
    }
    namespace migrations {
        let tableName: string;
        let directory: string;
        let extension: string;
    }
    namespace seeds {
        let directory_1: string;
        export { directory_1 as directory };
        let extension_1: string;
        export { extension_1 as extension };
    }
}
//# sourceMappingURL=knexfile.d.cts.map