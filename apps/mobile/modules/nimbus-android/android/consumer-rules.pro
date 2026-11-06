# Release builds shrink with R8. WorkManager's database is created by reflection through its
# no-argument constructor, which R8 removed (crash at start: WorkDatabase_Impl.<init>).
-keep class * extends androidx.room.RoomDatabase { <init>(); }
